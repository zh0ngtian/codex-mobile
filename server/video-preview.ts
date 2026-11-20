import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { localMediaFiles, type MediaFile, type MediaFileSource } from './media-file-source.js';

const videoContentTypes: Record<string, string> = {
  '.m4v': 'video/x-m4v', '.mov': 'video/quicktime', '.mp4': 'video/mp4',
  '.ogg': 'video/ogg', '.ogv': 'video/ogg', '.webm': 'video/webm',
};
function byteRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  let start: number; let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start < 0 || start >= size || end < start) return null;
  return { start, end };
}

/** 现行 GET 视频预览；调用方继续决定路由及方法，不改变普通附件下载语义。 */
export async function previewVideo(request: IncomingMessage, response: ServerResponse, url: URL, source: MediaFileSource = localMediaFiles) {
  const filePath = url.searchParams.get('path') ?? '';
  const contentType = videoContentTypes[source.paths.extname(filePath).toLowerCase()];
  if (!filePath || !source.paths.isAbsolute(filePath) || !contentType) {
    response.statusCode = 415; response.end('Unsupported video path'); return;
  }
  let file: MediaFile | undefined;
  const controller = new AbortController(); const abort = () => controller.abort();
  const closed = () => { if (!response.writableFinished) abort(); };
  request.once('aborted', abort); response.once('close', closed); if (request.aborted || response.destroyed) abort();
  try {
    file = await source.open(filePath, undefined, controller.signal); const details = file.details;
    if (details.type !== 'file') throw new Error('NOT_A_FILE');
    response.setHeader('accept-ranges', 'bytes'); response.setHeader('content-type', contentType); response.setHeader('cache-control', 'private, no-store');
    const rangeHeader = request.headers.range;
    let range: { start: number; end: number } | undefined;
    if (rangeHeader) {
      const selected = byteRange(rangeHeader, details.size);
      if (!selected) { response.statusCode = 416; response.setHeader('content-range', `bytes */${details.size}`); response.end(); return; }
      range = selected; response.statusCode = 206;
      response.setHeader('content-range', `bytes ${range.start}-${range.end}/${details.size}`);
    }
    const length = range ? range.end - range.start + 1 : details.size;
    response.setHeader('content-length', length);
    if (!length) { response.end(); return; }
    await pipeline(Readable.from(file.read(range?.start ?? 0, length), { objectMode: false }), response, { signal: controller.signal });
  } catch {
    if (response.headersSent || response.destroyed) response.destroy();
    else { response.removeHeader('content-length'); response.removeHeader('content-range'); response.statusCode = 404; response.end('Video not found'); }
  } finally { request.removeListener('aborted', abort); response.removeListener('close', closed); await file?.close().catch(() => {}); }
}
