import type { DesktopProjectMembership } from "../../../server/codex-projects";

/** 展示归属独立于执行目录。 */
export type ProjectWorktrees = Record<string, string[]>;

export function projectCwdOf(thread: Record<string, any>): string {
  return String(thread.projectCwd ?? thread.cwd ?? "");
}

export function assignedProjectCwd(thread: Record<string, any>, membership?: DesktopProjectMembership) {
  if (!membership || thread.isProjectless === true) return undefined;
  if (typeof thread.projectId === "string" && Object.hasOwn(membership.byProjectId, thread.projectId)) {
    return membership.byProjectId[thread.projectId];
  }
  if (typeof thread.id === "string" && Object.hasOwn(membership.byThreadId, thread.id)) {
    return membership.byThreadId[thread.id];
  }
  return undefined;
}

export function withProjectWorktree(thread: Record<string, any>, projects: ProjectWorktrees, membership?: DesktopProjectMembership) {
  const { projectCwd: _previous, ...record } = thread;
  if (thread.isProjectless === true) return record;
  const owner = assignedProjectCwd(thread, membership) ??
    Object.keys(projects).find(root => projects[root].includes(thread.cwd));
  return owner ? { ...record, projectCwd: owner } : record;
}
