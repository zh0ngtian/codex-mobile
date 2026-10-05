import { createHash } from "node:crypto";
import { open, stat, type FileHandle } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_CONVERSIONS = 2;
const MAX_WAITING_CONVERSIONS = 16;
const contentTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
};

class ImagePreviewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Thumbnail = { bytes: Buffer; etag: string };

function revision(path: string, details: BigIntStats) {
  return JSON.stringify([path, String(details.dev), String(details.ino), String(details.size),
    String(details.mtimeNs), String(details.ctimeNs)]);
}

function etagFor(value: string | Buffer) {
  return `"${createHash("sha256").update(value).digest("hex")}"`;
}

function matchesEtag(request: IncomingMessage, etag: string) {
  const header = request.headers["if-none-match"];
  return header?.split(",").some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag);
}

/** Each gateway owns a bounded thumbnail cache and conversion queue. */
export class ImagePreviews {
  private cache = new Map<string, Thumbnail>();
  private cacheBytes = 0;
  private inFlight = new Map<string, { promise: Promise<Thumbnail>; controller: AbortController; waiters: number; settled: boolean }>();
  private active = 0;
  private waiting: Array<{ resolve: () => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }> = [];

  private async acquire(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.active < MAX_CONVERSIONS) { this.active += 1; return; }
    if (this.waiting.length >= MAX_WAITING_CONVERSIONS) {
      throw new ImagePreviewError(503, "Image preview queue is full");
    }
    await new Promise<void>((resolve, reject) => {
      const queued = { resolve, reject, signal, abort: () => {
        const index = this.waiting.indexOf(queued);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new DOMException("Request canceled", "AbortError"));
      } };
      this.waiting.push(queued);
      signal.addEventListener("abort", queued.abort, { once: true });
    });
  }

  private release() {
    const next = this.waiting.shift();
    if (next) {
      next.signal.removeEventListener("abort", next.abort);
      next.resolve();
    } else this.active -= 1;
  }

  private async convert(path: string, key: string, signal: AbortSignal): Promise<Thumbnail> {
    await this.acquire(signal);
    let file: FileHandle | undefined;
    try {
      signal.throwIfAborted();
      // Only active jobs open source files; queued and coalesced requests hold no file descriptors.
      file = await open(path, "r");
      if (revision(path, await file.stat({ bigint: true })) !== key) {
        throw new ImagePreviewError(409, "Image changed while queued; retry preview");
      }
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of file.createReadStream({ start: 0, end: MAX_SOURCE_BYTES, autoClose: false })) {
        signal.throwIfAborted();
        const bytes = chunk as Buffer;
        size += bytes.length;
        if (size > MAX_SOURCE_BYTES) throw new ImagePreviewError(413, "Image exceeds 64 MiB");
        parts.push(bytes);
      }
      const source = Buffer.concat(parts, size);
      await file.close();
      file = undefined;
      signal.throwIfAborted();
      const bytes = await sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: "error" })
        .autoOrient()
        .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 80 })
        .toBuffer();
      // An active sharp operation can finish after cancellation, but its result must not enter the cache.
      signal.throwIfAborted();
      if (revision(path, await stat(path, { bigint: true })) !== key) {
        throw new ImagePreviewError(409, "Image changed during conversion; retry preview");
      }
      signal.throwIfAborted();
      const thumbnail = { bytes, etag: etagFor(Buffer.concat([Buffer.from(key), bytes])) };
      if (bytes.length <= MAX_CACHE_BYTES) {
        this.cache.set(key, thumbnail);
        this.cacheBytes += bytes.length;
        while (this.cache.size > MAX_CACHE_ENTRIES || this.cacheBytes > MAX_CACHE_BYTES) {
          const oldest = this.cache.keys().next().value!;
          this.cacheBytes -= this.cache.get(oldest)!.bytes.length;
          this.cache.delete(oldest);
        }
      }
      return thumbnail;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ImagePreviewError) throw error;
      if (error instanceof Error && /pixel limit/i.test(error.message)) {
        throw new ImagePreviewError(413, "Image exceeds 40 million pixels");
      }
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        throw new ImagePreviewError(404, "Image not found");
      }
      throw new ImagePreviewError(415, "Unsupported or invalid image");
    } finally {
      await file?.close().catch(() => {});
      this.release();
    }
  }

  private async thumbnail(path: string, key: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    let job = this.inFlight.get(key);
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController();
      const created = { controller, waiters: 0, settled: false, promise: undefined as unknown as Promise<Thumbnail> };
      created.promise = Promise.resolve().then(() => this.convert(path, key, controller.signal)).finally(() => {
        created.settled = true;
        if (this.inFlight.get(key) === created) this.inFlight.delete(key);
      });
      this.inFlight.set(key, created);
      job = created;
    }
    const shared = job;
    shared.waiters += 1;
    let abort: () => void = () => {};
    try {
      return await Promise.race([shared.promise, new Promise<never>((_, reject) => {
        abort = () => reject(new DOMException("Request canceled", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
      })]);
    } finally {
      signal.removeEventListener("abort", abort);
      shared.waiters -= 1;
      if (shared.waiters === 0 && !shared.settled) shared.controller.abort();
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    let file: FileHandle | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const responseClosed = () => { if (!response.writableFinished) abort(); };
    request.once("aborted", abort);
    response.once("close", responseClosed);
    if (response.destroyed || request.aborted) abort();
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD, OPTIONS");
        throw new ImagePreviewError(405, "Method not allowed");
      }
      const path = url.searchParams.get("path") ?? "";
      const contentType = contentTypes[extname(path).toLowerCase()];
      if (!isAbsolute(path) || path.includes("\0") || !contentType) {
        throw new ImagePreviewError(415, "Unsupported image path");
      }
      let details: BigIntStats;
      try { details = await stat(path, { bigint: true }); }
      catch { throw new ImagePreviewError(404, "Image not found"); }
      if (!details.isFile()) throw new ImagePreviewError(404, "Image not found");
      if (details.size === 0n) throw new ImagePreviewError(415, "Empty image");
      if (details.size > BigInt(MAX_SOURCE_BYTES)) throw new ImagePreviewError(413, "Image exceeds 64 MiB");
      const key = revision(path, details);
      const thumbnail = url.searchParams.get("thumbnail") === "1" ? await this.thumbnail(path, key, controller.signal) : null;
      controller.signal.throwIfAborted();
      const etag = thumbnail?.etag ?? etagFor(key);
      // Always revalidate against current file identity, including overwrites preserving mtime and size.
      response.setHeader("cache-control", "private, no-cache");
      response.setHeader("etag", etag);
      response.setHeader("content-type", thumbnail ? "image/jpeg" : contentType);
      response.setHeader("x-content-type-options", "nosniff");
      if (matchesEtag(request, etag)) {
        response.statusCode = 304;
        response.end();
        return;
      }
      response.setHeader("content-length", thumbnail ? thumbnail.bytes.length : String(details.size));
      if (request.method === "HEAD") { response.end(); return; }
      if (thumbnail) { response.end(thumbnail.bytes); return; }
      // pipeline observes read/client errors; no unhandled stream error can terminate the gateway.
      file = await open(path, "r");
      if (revision(path, await file.stat({ bigint: true })) !== key) {
        throw new ImagePreviewError(409, "Image changed before download; retry preview");
      }
      await pipeline(file.createReadStream({ start: 0, end: Number(details.size) - 1, autoClose: false }), response);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
      } else {
        response.removeHeader("content-length");
        response.removeHeader("etag");
        response.setHeader("cache-control", "private, no-store");
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.statusCode = error instanceof ImagePreviewError ? error.status : 500;
        if (response.statusCode === 503) response.setHeader("retry-after", "1");
        response.end(error instanceof ImagePreviewError ? error.message : "Unable to read image");
      }
    } finally {
      request.removeListener("aborted", abort);
      response.removeListener("close", responseClosed);
      await file?.close().catch(() => {});
    }
  }
}
