export interface WorkspaceBootstrapTasks<Settings> {
  loadThreads: () => Promise<void>;
  loadSettings: () => Promise<Settings>;
  loadRateLimits: () => Promise<void>;
}

export async function runWorkspaceBootstrap<Settings>({
  loadThreads,
  loadSettings,
  loadRateLimits,
}: WorkspaceBootstrapTasks<Settings>) {
  const threads = loadThreads();
  const settings = loadSettings();
  void loadRateLimits().catch(() => undefined);
  const [result] = await Promise.all([settings, threads]);
  return result;
}

export interface WorkspaceResumeSnapshot {
  threadId: string | null;
  openSequence: number;
}

export function shouldResumeWorkspaceThread(
  captured: WorkspaceResumeSnapshot,
  current: WorkspaceResumeSnapshot,
) {
  return Boolean(
    captured.threadId &&
      captured.threadId === current.threadId &&
      captured.openSequence === current.openSequence,
  );
}
