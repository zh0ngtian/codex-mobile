import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { localMediaFiles, type MediaFile, type MediaFileSource } from './media-file-source.js';

const types: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".svg": "image/svg+xml", ".pdf": "application/pdf", ".zip": "application/zip",
  ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8",
};

/** 原文件通过已鉴权的网关下载，避免把电脑路径或预览数据交给客户端下载器。 */
export async function downloadFile(request: IncomingMessage, response: ServerResponse, url: URL, source: MediaFileSource = localMediaFiles) {
  let file: MediaFile | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const closed = () => { if (!response.writableFinished) abort(); };
  request.once('aborted', abort); response.once('close', closed);
  if (request.aborted || response.destroyed) abort();
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD, OPTIONS");
      response.statusCode = 405; response.end("Method not allowed"); return;
    }
    const path = url.searchParams.get("path") ?? "";
    if (!source.paths.isAbsolute(path) || path.includes("\0")) {
      response.statusCode = 400; response.end("Invalid file path"); return;
    }
    file = await source.open(path, undefined, controller.signal);
    const details = file.details;
    if (details.type !== 'file') {
      response.statusCode = 404; response.end("File not found"); return;
    }
    const name = source.paths.basename(path).replace(/[\u0000-\u001f\u007f]/g, "") || "download";
    const encodedName = encodeURIComponent(name).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodedName}`);
    response.setHeader("content-type", types[source.paths.extname(path).toLowerCase()] ?? "application/octet-stream");
    response.setHeader("content-length", details.size);
    response.setHeader("cache-control", "private, no-store");
    response.setHeader("x-content-type-options", "nosniff");
    if (request.method === "HEAD" || details.size === 0) { response.end(); return; }
    await pipeline(Readable.from(file.read(), { objectMode: false }), response, { signal: controller.signal });
  } catch (error) {
    if (response.headersSent || response.destroyed) response.destroy();
    else {
      response.removeHeader("content-length");
      response.removeHeader("content-disposition");
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.statusCode = ["ENOENT", "ENOTDIR", "not-found"].includes((error as NodeJS.ErrnoException).code ?? "") ? 404 : 500;
      response.end(response.statusCode === 404 ? "File not found" : "Unable to download file");
    }
  } finally { request.removeListener('aborted', abort); response.removeListener('close', closed); await file?.close().catch(() => {}); }
}
