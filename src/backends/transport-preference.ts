export type TransportMode = "http" | "stream";

const storageKey = "codex-mobile:transport-mode";

export function readTransportMode(storage: Storage): TransportMode {
  try {
    return storage.getItem(storageKey) === "stream" ? "stream" : "http";
  } catch {
    return "http";
  }
}

export function writeTransportMode(storage: Storage, mode: TransportMode) {
  try {
    storage.setItem(storageKey, mode);
  } catch {
    // 存储不可用时，当前客户端仍使用内存中的选择。
  }
}
