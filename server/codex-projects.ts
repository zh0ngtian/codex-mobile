import { readFile } from "node:fs/promises";

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
  return parseCodexProjectState(await readFile(globalStatePath, "utf8"));
}
