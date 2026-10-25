import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

interface CodexLocalProject {
  id?: unknown;
  rootPaths?: unknown;
}

interface CodexGlobalState {
  "local-projects"?: unknown;
  "project-order"?: unknown;
  "projectless-thread-ids"?: unknown;
}

export interface CodexProjectState {
  projects: string[];
  projectlessThreadIds: string[];
  projectWorktrees?: Record<string, string[]>;
}

export function parseCodexProjectState(globalState: string): CodexProjectState {
  const state = JSON.parse(globalState) as CodexGlobalState;
  const localProjects = state["local-projects"];
  const localProjectRecords =
    localProjects &&
    typeof localProjects === "object" &&
    !Array.isArray(localProjects)
      ? (Object.values(localProjects) as CodexLocalProject[])
      : [];
  const localProjectsById = new Map(
    localProjectRecords.flatMap((project) =>
      typeof project?.id === "string" ? [[project.id, project] as const] : [],
    ),
  );
  const projectOrder = Array.isArray(state["project-order"])
    ? state["project-order"].filter(
        (projectId): projectId is string => typeof projectId === "string",
      )
    : [];
  const orderedProjectIds = new Set(projectOrder);
  const orderedLocalProjects = [
    ...localProjectRecords.filter(
      (project) =>
        typeof project?.id !== "string" || !orderedProjectIds.has(project.id),
    ),
    ...projectOrder.flatMap((projectId) => {
      const project = localProjectsById.get(projectId);
      return project ? [project] : [];
    }),
  ];

  const projects = new Set<string>();
  for (const project of orderedLocalProjects) {
    if (!project || typeof project !== "object" || !Array.isArray(project.rootPaths)) {
      continue;
    }
    for (const rootPath of project.rootPaths) {
      if (typeof rootPath === "string" && rootPath.trim()) {
        projects.add(rootPath);
      }
    }
  }
  const projectlessThreadIds = new Set(
    Array.isArray(state["projectless-thread-ids"])
      ? state["projectless-thread-ids"].filter(
          (threadId): threadId is string =>
            typeof threadId === "string" && Boolean(threadId.trim()),
        )
      : [],
  );
  return {
    projects: [...projects],
    projectlessThreadIds: [...projectlessThreadIds],
  };
}

export function parseCodexProjectDirectories(globalState: string) {
  return parseCodexProjectState(globalState).projects;
}

export async function readCodexProjectDirectories(globalStatePath: string) {
  return parseCodexProjectDirectories(await readFile(globalStatePath, "utf8"));
}

export async function readCodexProjectState(globalStatePath: string) {
  const state = parseCodexProjectState(await readFile(globalStatePath, "utf8"));
  const projectWorktrees: Record<string, string[]> = {};
  const registered = new Set(state.projects);
  for (const root of state.projects) {
    let output: string;
    try {
      ({ stdout: output } = await execute("git", ["--no-optional-locks", "-C", root, "worktree", "list", "--porcelain", "-z"], {
        timeout: 3_000, maxBuffer: 1024 * 1024,
      }));
    } catch (error: any) {
      // 普通文件夹及已删除的项目没有 Git worktree；其他读取故障必须报告。
      if (error.code === 128 && /not a git repository|cannot change to .*No such file or directory/.test(error.stderr ?? "")) continue;
      throw error;
    }
    const paths = output.split("\0").filter(part => part.startsWith("worktree ")).map(part => part.slice(9));
    // 以已登记的主工作区为归属；显式登记的另一个工作区仍保持独立项目。
    if (paths[0] !== root) continue;
    const worktrees = paths.slice(1).filter(path => !registered.has(path));
    if (worktrees.length) projectWorktrees[root] = worktrees;
  }
  return Object.keys(projectWorktrees).length ? { ...state, projectWorktrees } : state;
}
