/** 展示归属独立于执行目录；仅使用网关确认的 Git worktree 关系。 */
export type ProjectWorktrees = Record<string, string[]>;

export function projectCwdOf(thread: Record<string, any>): string {
  return String(thread.projectCwd ?? thread.cwd ?? "");
}

export function withProjectWorktree(thread: Record<string, any>, projects: ProjectWorktrees) {
  const { projectCwd: _previous, ...record } = thread;
  if (thread.isProjectless === true) return record;
  const owner = Object.keys(projects).find(root => projects[root].includes(thread.cwd));
  return owner ? { ...record, projectCwd: owner } : record;
}
