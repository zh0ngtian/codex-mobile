import type { AppServerClient } from "../../app-server/client";
import type { BackendConfig } from "../../backends/types";
import { remoteImagePreviewUrl } from "../../backends/file-upload";

export interface LoadedImage { src: string; size: number; thumbnail: boolean }
interface CacheEntry { promise: Promise<LoadedImage>; expiresAt: number; bytes: number }
interface GatewaySupport { promise: Promise<boolean>; expiresAt: number }
interface ImageCache {
  entries: Map<string, CacheEntry>;
  pending: Map<string, Promise<LoadedImage>>;
  gateways: Map<string, GatewaySupport>;
  bytes: number;
}
const caches = new WeakMap<AppServerClient, ImageCache>();
const gatewayCaches = new Map<string, ImageCache>();
const cacheBytesLimit = 8 * 1024 * 1024;
const cacheEntryLimit = 128;
const cacheTtl = 60_000;
const missingTtl = 15_000;

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(blob);
  });
}

function missingImage(reason: unknown) {
  return reason instanceof Error && /file missing|not found|no such file|ENOENT|os error 2/i.test(reason.message);
}

export function loadCachedImage(
  client: AppServerClient | null,
  source: string,
  mime: string,
  backend?: BackendConfig | null,
  thumbnail = true,
): Promise<LoadedImage> {
  const gatewayKey = JSON.stringify([backend?.baseUrl, backend?.token]);
  let cache = client ? caches.get(client) : backend ? gatewayCaches.get(gatewayKey) : undefined;
  if (!cache) {
    cache = { entries: new Map(), pending: new Map(), gateways: new Map(), bytes: 0 };
    if (client) caches.set(client, cache);
    else if (backend) {
      gatewayCaches.set(gatewayKey, cache);
      while (gatewayCaches.size > 8) gatewayCaches.delete(gatewayCaches.keys().next().value!);
    }
  }
  const key = JSON.stringify([backend?.baseUrl, backend?.token, source, thumbnail]);
  const saved = cache.entries.get(key);
  if (saved) {
    cache.entries.delete(key);
    if (saved.expiresAt > Date.now()) {
      cache.entries.set(key, saved);
      return saved.promise;
    }
    cache.bytes -= saved.bytes;
  }
  const inflight = cache.pending.get(key);
  if (inflight) return inflight;

  const rememberSupport = (promise: Promise<boolean>) => {
    cache!.gateways.set(gatewayKey, { promise, expiresAt: Date.now() + cacheTtl });
    while (cache!.gateways.size > 8) cache!.gateways.delete(cache!.gateways.keys().next().value!);
    void promise.catch(() => cache!.gateways.delete(gatewayKey));
    return promise;
  };
  const existingSupport = () => {
    const support = cache!.gateways.get(gatewayKey);
    return support && support.expiresAt > Date.now() ? support.promise : null;
  };
  const probeSupport = () => existingSupport() ?? rememberSupport((async () => {
    const url = new URL("/api/host", `${backend!.baseUrl}/`);
    if (backend!.token) url.searchParams.set("token", backend!.token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url.toString(), { mode: "cors", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Gateway request failed (${response.status})`);
      return (await response.json()).imagePreview === true;
    } finally { clearTimeout(timeout); }
  })());
  const fetchImage = async (): Promise<LoadedImage> => {
    if (backend && (!existingSupport() || await existingSupport())) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), thumbnail ? 30_000 : 180_000);
      try {
        const response = await fetch(remoteImagePreviewUrl(backend, source, thumbnail), {
          mode: "cors", cache: "no-store", signal: controller.signal,
        });
        if (response.status === 404 && !response.headers.has("x-codex-image-preview")) {
          rememberSupport(Promise.resolve(false));
        } else {
          if (!response.ok) throw new Error(response.status === 404 ? "Image not found" : `Image request failed (${response.status})`);
          const blob = await response.blob();
          return { src: await blobDataUrl(blob), size: blob.size, thumbnail };
        }
      } catch (reason) {
        // 跨源旧网关的未知接口没有 CORS，浏览器看不到其 404；通过已有接口确认后再回退。
        if (!(reason instanceof TypeError) || await probeSupport()) throw reason;
      } finally { clearTimeout(timeout); }
    }
    if (!client) throw new Error("App server connection unavailable");
    const result = await client.request<{ dataBase64: string }>("fs/readFile", { path: source }, { timeoutMs: 180_000 });
    return { src: `data:${mime};base64,${result.dataBase64}`, size: Math.floor(result.dataBase64.length * 3 / 4), thumbnail: false };
  };
  const promise = fetchImage();
  cache.pending.set(key, promise);
  const retain = (bytes: number, ttl: number) => {
    cache!.pending.delete(key);
    if (bytes > cacheBytesLimit) return;
    cache!.entries.set(key, { promise, bytes, expiresAt: Date.now() + ttl });
    cache!.bytes += bytes;
    while (cache!.bytes > cacheBytesLimit || cache!.entries.size > cacheEntryLimit) {
      const first = cache!.entries.keys().next().value!;
      cache!.bytes -= cache!.entries.get(first)!.bytes;
      cache!.entries.delete(first);
    }
  };
  void promise.then(
    result => retain(result.src.length * 2, cacheTtl),
    reason => { cache!.pending.delete(key); if (missingImage(reason)) retain(0, missingTtl); },
  );
  return promise;
}
