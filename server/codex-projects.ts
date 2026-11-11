import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
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
  "thread-project-assignments"?: unknown;
  "thread-project-membership-host-ids"?: unknown;
  "app-server-project-id-by-legacy-project-id-by-host"?: unknown;
}

export interface DesktopProjectMembership {
  byThreadId: Record<string, string>;
  byProjectId: Record<string, string>;
  extraRoots: Record<string, string[]>;
}

export interface CodexProjectState {
  projects: string[];
  projectlessThreadIds: string[];
  projectWorktrees?: Record<string, string[]>;
  projectMembership?: DesktopProjectMembership;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function parseCodexProjectState(globalState: string, codexHome?: string): CodexProjectState {
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
  const byProjectId = new Map<string, string>();
  const extraRoots = new Map<string, string[]>();
  for (const project of orderedLocalProjects) {
    if (!project || typeof project !== "object" || !Array.isArray(project.rootPaths)) {
      continue;
    }
    const roots = [...new Set(project.rootPaths.filter(
      (rootPath): rootPath is string => typeof rootPath === "string" && Boolean(rootPath.trim()),
    ))];
    for (const rootPath of roots) projects.add(rootPath);
    const [primary, ...additional] = roots;
    if (!primary || typeof project.id !== "string" || !project.id.trim()) continue;
    byProjectId.set(project.id, primary);
    if (additional.length) {
      extraRoots.set(primary, [...new Set([...(extraRoots.get(primary) ?? []), ...additional])]);
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
  const byThreadId = new Map<string, string>();
  const hosts = record(state["thread-project-membership-host-ids"]);
  const localHostKey = codexHome ? `local:${codexHome}` : undefined;
  for (const [threadId, value] of Object.entries(record(state["thread-project-assignments"]))) {
    const host = hosts[threadId];
    if (!threadId.trim() || projectlessThreadIds.has(threadId) ||
      (host !== undefined && host !== "local" && host !== localHostKey)) continue;
    const assignment = record(value);
    if (assignment.projectKind !== "local" || typeof assignment.projectId !== "string") continue;
    const root = byProjectId.get(assignment.projectId);
    if (root) byThreadId.set(threadId, root);
  }
  if (localHostKey) {
    const aliases = record(record(state["app-server-project-id-by-legacy-project-id-by-host"])[localHostKey]);
    for (const [legacyId, nativeId] of Object.entries(aliases)) {
      const root = byProjectId.get(legacyId);
      if (root && typeof nativeId === "string" && nativeId.trim() && !byProjectId.has(nativeId)) {
        byProjectId.set(nativeId, root);
      }
    }
  }
  return {
    projects: [...projects],
    projectlessThreadIds: [...projectlessThreadIds],
    ...(byProjectId.size ? { projectMembership: {
      byThreadId: Object.fromEntries(byThreadId),
      byProjectId: Object.fromEntries(byProjectId),
      extraRoots: Object.fromEntries(extraRoots),
    } } : {}),
  };
}

export function parseCodexProjectDirectories(globalState: string) {
  return parseCodexProjectState(globalState).projects;
}

export async function readCodexProjectDirectories(globalStatePath: string) {
  return parseCodexProjectDirectories(await readFile(globalStatePath, "utf8"));
}

export async function readCodexProjectState(globalStatePath: string) {
  const state = parseCodexProjectState(await readFile(globalStatePath, "utf8"), dirname(globalStatePath));
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
