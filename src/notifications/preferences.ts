import { useEffect, useState } from "react";
import { parseBarkPushUrl, type NotificationPreference } from "../../server/notification-settings";
import { transportUuid } from "../backends/http-transport";
import type { BackendConfig } from "../backends/types";

export type { NotificationPreference };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const PREFERENCE_KEY = "codex-mobile:notification-preference";
const CLIENT_KEY = "codex-mobile:notification-client";
const TARGETS_KEY = "codex-mobile:notification-targets";
const systemPreference: NotificationPreference = { mode: "system", barkUrl: "" };

export function readNotificationPreference(storage: Pick<Storage, "getItem">): NotificationPreference {
  try {
    const saved = JSON.parse(storage.getItem(PREFERENCE_KEY) ?? "null");
    if (saved?.mode === "bark") return { mode: "bark", barkUrl: parseBarkPushUrl(saved.barkUrl) };
    if (saved?.mode === "system") return { mode: "system", barkUrl: typeof saved.barkUrl === "string" ? saved.barkUrl : "" };
  } catch { /* 损坏或不可访问的设置回退到系统通知。 */ }
  return { ...systemPreference };
}

export function writeNotificationPreference(storage: PreferenceStorage, preference: NotificationPreference) {
  const normalized = { ...preference, barkUrl: preference.mode === "bark" ? parseBarkPushUrl(preference.barkUrl) : preference.barkUrl };
  storage.setItem(PREFERENCE_KEY, JSON.stringify(normalized));
  return normalized;
}

type Target = Pick<BackendConfig, "id" | "name" | "baseUrl" | "token">;
const targetKey = (target: Target) => `${target.id}\u0000${target.baseUrl}`;
let syncQueue: Promise<unknown> = Promise.resolve();

/** 串行同步，确保慢网络中最后一次保存覆盖先前方式。 */
export function syncNotificationSettings(
  backends: BackendConfig[], preference: NotificationPreference,
  storage: PreferenceStorage, fetcher: typeof fetch = globalThis.fetch,
): Promise<string[]> {
  const run = async () => {
    let clientId = storage.getItem(CLIENT_KEY);
    if (!clientId || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(clientId)) {
      clientId = transportUuid(); storage.setItem(CLIENT_KEY, clientId);
    }
    let previous: Target[] = [];
    try {
      const saved = JSON.parse(storage.getItem(TARGETS_KEY) ?? "[]");
      if (Array.isArray(saved)) previous = saved.filter((target) =>
        target && [target.id, target.name, target.baseUrl, target.token].every((value) => typeof value === "string"),
      ).slice(0, 64);
    } catch { /* 首次注册不依赖已有同步记录。 */ }
    const targets = new Map(previous.map((target) => [targetKey(target), target]));
    const enabled = new Set(backends.filter((backend) => backend.enabled).map(targetKey));
    for (const backend of backends) {
      if (targets.has(targetKey(backend)) || (backend.enabled && preference.mode === "bark")) {
        targets.set(targetKey(backend), { id: backend.id, name: backend.name, baseUrl: backend.baseUrl, token: backend.token });
      }
    }
    // 保存所有尝试过的网关，响应丢失或设备移除后仍能注销远端订阅。
    storage.setItem(TARGETS_KEY, JSON.stringify([...targets.values()]));
    const retained: Target[] = [];
    const failed: string[] = [];
    await Promise.all([...targets.values()].map(async (target) => {
      const mode = enabled.has(targetKey(target)) ? preference.mode : "system";
      try {
        const url = new URL("/api/notifications/settings", `${target.baseUrl}/`);
        if (target.token) url.searchParams.set("token", target.token);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetcher(url.toString(), {
            method: "POST", mode: "cors", cache: "no-store", signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId, backendId: target.id, mode, barkUrl: mode === "bark" ? preference.barkUrl : "" }),
          });
          if (!response.ok || (await response.json()).saved !== true) throw new Error("Registration rejected");
        } finally { clearTimeout(timer); }
        if (mode === "bark") retained.push(target);
      } catch { retained.push(target); failed.push(target.name); }
    }));
    storage.setItem(TARGETS_KEY, JSON.stringify(retained));
    return [...new Set(failed)].sort();
  };
  const result = syncQueue.then(run, run);
  syncQueue = result.catch(() => {});
  return result;
}

export function useNotificationSync(backends: BackendConfig[], preference: NotificationPreference) {
  const [failedDevices, setFailedDevices] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const synchronize = async () => {
      if (running) return;
      running = true;
      try {
        const failed = await syncNotificationSettings(backends, preference, window.localStorage);
        if (!cancelled) setFailedDevices(failed);
      } catch {
        if (!cancelled) setFailedDevices(backends.filter((backend) => backend.enabled).map((backend) => backend.name));
      } finally { running = false; }
    };
    void synchronize();
    const retry = () => { if (document.visibilityState === "visible") void synchronize(); };
    const timer = window.setInterval(retry, 30_000);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      cancelled = true; window.clearInterval(timer);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [backends, preference]);
  return failedDevices;
}
