import { PROJECTLESS_GROUP_ID } from "../../app-server/thread-list-loader";

export type ProjectOrders = Record<string, string[]>;
export type ProjectPlacement = "before" | "after";
export const projectOrderStorageKey = "codex-mobile:project-order";

export function applyProjectOrder(directories: string[], order: string[] = []) {
  const remaining = new Set(directories);
  const result: string[] = [];
  if (remaining.delete(PROJECTLESS_GROUP_ID)) result.push(PROJECTLESS_GROUP_ID);
  for (const cwd of order) {
    if (remaining.delete(cwd)) result.push(cwd);
  }
  return [...result, ...remaining];
}

export function moveProject(
  directories: string[], cwd: string, targetCwd: string,
  placement: ProjectPlacement,
) {
  if (cwd === PROJECTLESS_GROUP_ID || targetCwd === PROJECTLESS_GROUP_ID ||
    cwd === targetCwd || !directories.includes(cwd) || !directories.includes(targetCwd)) {
    return directories;
  }
  const next = directories.filter((directory) => directory !== cwd);
  next.splice(next.indexOf(targetCwd) + (placement === "after" ? 1 : 0), 0, cwd);
  return next;
}

export function readProjectOrders(storage: Pick<Storage, "getItem">): ProjectOrders {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(projectOrderStorageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !Object.values(parsed).every((order) => Array.isArray(order) && order.every((cwd) => typeof cwd === "string"))) {
      return {};
    }
    return parsed as ProjectOrders;
  } catch {
    return {};
  }
}

export function writeProjectOrders(storage: Pick<Storage, "setItem">, orders: ProjectOrders) {
  storage.setItem(projectOrderStorageKey, JSON.stringify(orders));
}
