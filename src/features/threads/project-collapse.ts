export const collapsedProjectsStorageKey =
  "codex-mobile:collapsed-projects";

interface ProjectCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function projectCollapseKey(backendId: string, cwd: string) {
  return `${backendId}:${cwd}`;
}

const defaultCollapsed = "codex-mobile://default-collapsed";
const expandedPrefix = "codex-mobile://expanded/";
const expandedKey = (backendId: string, cwd: string) =>
  projectCollapseKey(backendId, expandedPrefix + encodeURIComponent(cwd));

/** 首次使用和新设备默认折叠；已有缓存继续保留逐项目记忆。 */
export function isProjectCollapsed(keys: Set<string>, backendId: string, cwd: string) {
  return keys.has(projectCollapseKey(backendId, cwd)) ||
    ((keys.has(defaultCollapsed) || keys.has(projectCollapseKey(backendId, defaultCollapsed))) && !keys.has(expandedKey(backendId, cwd)));
}

export function toggleProjectCollapsedKeys(keys: Set<string>, backendId: string, cwd: string) {
  const next = new Set(keys), key = projectCollapseKey(backendId, cwd);
  if (isProjectCollapsed(keys, backendId, cwd)) {
    next.delete(key);
    if (keys.has(defaultCollapsed) || keys.has(projectCollapseKey(backendId, defaultCollapsed))) next.add(expandedKey(backendId, cwd));
  } else {
    next.add(key); next.delete(expandedKey(backendId, cwd));
  }
  return next;
}

export function collapseNewBackendProjects(keys: Set<string>, backendIds: string[]) {
  const next = new Set(keys);
  for (const backendId of backendIds) {
    for (const key of next) if (key.startsWith(projectCollapseKey(backendId, expandedPrefix))) next.delete(key);
    next.add(projectCollapseKey(backendId, defaultCollapsed));
  }
  return next;
}

export function readCollapsedProjectKeys(
  storage: Pick<ProjectCollapseStorage, "getItem">,
) {
  try {
    const stored = storage.getItem(collapsedProjectsStorageKey);
    if (stored === null) return new Set([defaultCollapsed]);
    const parsed = JSON.parse(stored);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value) => typeof value === "string")
    ) {
      return new Set<string>();
    }
    return new Set(parsed);
  } catch {
    return new Set<string>();
  }
}

export function writeCollapsedProjectKeys(
  storage: Pick<ProjectCollapseStorage, "setItem">,
  keys: Set<string>,
) {
  storage.setItem(
    collapsedProjectsStorageKey,
    JSON.stringify([...keys].sort()),
  );
}
