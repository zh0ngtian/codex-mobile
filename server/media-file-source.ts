import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path, { posix, win32 } from 'node:path';
import { RemoteFiles, REMOTE_FILE_LIMITS } from './remote/files.js';

export interface MediaFileDetails { path: string; type: 'file' | 'directory' | 'symlink' | 'other'; size: number; version: string }
export interface MediaFile {
  readonly details: MediaFileDetails;
  read(offset?: number, length?: number): AsyncIterable<Buffer>;
  close(): Promise<void>;
}
/** 只由可信服务端注入；路径不决定来源，也不从 HTTP 的 origin/scope 构造来源。 */
export interface MediaFileSource {
  readonly kind: 'local' | 'remote';
  readonly namespace: string;
  readonly paths: Pick<typeof path, 'isAbsolute' | 'basename' | 'extname'>;
  stat(path: string, signal?: AbortSignal): Promise<MediaFileDetails>;
  open(path: string, version?: string, signal?: AbortSignal): Promise<MediaFile>;
}
export interface MediaFileReference { source: MediaFileSource; path: string; origin: 'target' | 'gateway-cache' }
export class MediaFileVersionError extends Error {
  constructor() { super('File changed; retry request'); }
}

function localDetails(path: string, value: BigIntStats): MediaFileDetails {
  return { path, type: value.isFile() ? 'file' : value.isDirectory() ? 'directory' : value.isSymbolicLink() ? 'symlink' : 'other',
    size: Number(value.size), version: JSON.stringify([path, String(value.dev), String(value.ino), String(value.size), String(value.mtimeNs), String(value.ctimeNs)]) };
}

export const localMediaFiles: MediaFileSource = Object.freeze({
  kind: 'local', namespace: 'gateway-local-media', paths: path,
  async stat(path: string, signal?: AbortSignal) { signal?.throwIfAborted(); return localDetails(path, await stat(path, { bigint: true })); },
  async open(path: string, version?: string, signal?: AbortSignal) {
    signal?.throwIfAborted(); const file = await open(path, 'r');
    try {
      const details = localDetails(path, await file.stat({ bigint: true })); signal?.throwIfAborted();
      if (version !== undefined && details.version !== version) throw new MediaFileVersionError();
      return { details,
        async *read(offset = 0, length = details.size - offset) {
          signal?.throwIfAborted(); if (!length) return;
          for await (const bytes of file.createReadStream({ start: offset, end: offset + length - 1, autoClose: false, signal })) yield bytes as Buffer;
        },
        async close() { await file.close(); },
      };
    } catch (error) { await file.close().catch(() => {}); throw error; }
  },
});

/** RemoteFiles 已证明目标身份/默认权限；额外绑定可信网关，绝不访问网关同名文件。 */
export function remoteMediaFiles(files: RemoteFiles, gatewayId: string): MediaFileSource {
  if (!(files instanceof RemoteFiles) || typeof gatewayId !== 'string' || !gatewayId.length || gatewayId.length > 4096 || /[\u0000-\u001f\u007f]/.test(gatewayId)) throw new TypeError('Trusted gateway and RemoteFiles are required');
  const namespace = createHash('sha256').update(JSON.stringify(['remote-media-v1', gatewayId, files.scope, files.metadata])).digest('hex');
  const paths = files.metadata.platformFamily === 'windows' ? win32 : posix;
  const source: MediaFileSource = {
    kind: 'remote', namespace, paths: {
      isAbsolute: (value: string) => paths.isAbsolute(value) && (files.metadata.platformFamily !== 'windows' || /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value)),
      basename: paths.basename, extname: paths.extname,
    },
    async stat(path, signal) {
      const details = await files.stat(path, { signal });
      return { ...details, version: JSON.stringify([namespace, details.version]) };
    },
    async open(path, version, signal) {
      const selected = await files.stat(path, { signal });
      const details = { ...selected, version: JSON.stringify([namespace, selected.version]) };
      if (version !== undefined && version !== details.version) throw new MediaFileVersionError();
      const controller = new AbortController(); const cancelled = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', cancelled, { once: true }); if (signal?.aborted) cancelled();
      return { details,
        async *read(offset = 0, length = selected.size - offset) {
          let pending: Buffer | undefined;
          // 单次能力上限不改变媒体大小；每段绑定同一个冻结版本，保持流式背压。
          for (let position = 0; position < length; position += REMOTE_FILE_LIMITS.maxBytes) {
            const size = Math.min(REMOTE_FILE_LIMITS.maxBytes, length - position);
            for await (const bytes of files.read(path, { offset: offset + position, length: size, version: selected.version, timeoutMs: 600000, signal: controller.signal })) {
              if (pending) yield pending;
              pending = bytes;
            }
          }
          controller.signal.throwIfAborted();
          if ((await source.stat(path, controller.signal)).version !== details.version) throw new MediaFileVersionError();
          // 最后一块在所有窗口与最终版本复核后才交给 Content-Length 响应。
          if (pending) yield pending;
        },
        async close() { signal?.removeEventListener('abort', cancelled); controller.abort(); },
      };
    },
  };
  return Object.freeze(source);
}
