import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PrivateStore } from './remote/private-store.js';
import { TargetResolver } from './targets.js';
import { GatewayRemoteServices } from './gateway-remote-services.js';
import type { RemoteUploadOperation } from './remote/files.js';
import type { OperationContext } from './operation-queue.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES = 100 * 1024 * 1024;
interface Metadata { name: string; type: string }
interface Uploaded extends Metadata { path: string; size: number }
interface Entry extends Metadata {
  version: 1; id: string; context: OperationContext; size: number; sha256: string;
  state: 'retained' | 'uploading' | 'committed'; operation?: RemoteUploadOperation; result?: Uploaded;
}
const signed = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value.map(signed));
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, signed(value)]));
  return JSON.stringify(value);
};
function fail(status: number): never { throw Object.assign(new Error('附件存储或原上传结果不可用'), { status }); }

/** 网关自有附件 bytes 独立耐久；不按时间清理仍可能被队列/草稿引用的文件。 */
export class GatewayAttachments {
  private readonly store: PrivateStore;
  constructor(private options: { directory: string; resolver: TargetResolver;
    services: (context: OperationContext, signal?: AbortSignal) => Promise<GatewayRemoteServices> }) {
    if (!(options.resolver instanceof TargetResolver)) throw new TypeError('需要可信目标解析器');
    this.store = new PrivateStore(options.directory);
  }
  private check(id: string) { if (!UUID.test(id)) fail(400); }
  private async entry(id: string, context: OperationContext, signal?: AbortSignal): Promise<{ value: Entry; fence: () => void }> {
    this.check(id); const fence = await this.options.resolver.authorizeOperation(context, 'read', signal);
    const value = await this.store.readJson(id + '.json') as Entry | null;
    if (!value) fail(404);
    if (value.version !== 1 || value.id !== id || signed(value.context) !== signed(context) || !['retained', 'uploading', 'committed'].includes(value.state) ||
      !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_BYTES || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.name !== 'string' || typeof value.type !== 'string' || (value.state === 'committed' && (!value.result || typeof value.result.path !== 'string' || value.result.size !== value.size))) fail(409);
    fence(); signal?.throwIfAborted(); return { value, fence };
  }
  async retain(id: string, context: OperationContext, bytes: AsyncIterable<Uint8Array>, metadata: Metadata, signal?: AbortSignal) {
    this.check(id); context = structuredClone(context);
    if (context.mode !== 'remote' || typeof metadata.name !== 'string' || !metadata.name || metadata.name.length > 240 || /[\u0000-\u001f\u007f]/.test(metadata.name) ||
      typeof metadata.type !== 'string' || metadata.type.length > 256 || /[\u0000-\u001f\u007f]/.test(metadata.type)) fail(400);
    const fence = await this.options.resolver.authorizeOperation(context, 'submit', signal);
    return this.store.withInitialization('attachment-' + id, async () => {
      const temporary = join(this.store.directory, `${id}-${randomUUID()}.part`);
      const file = await open(temporary, 'wx', 0o600); const hash = createHash('sha256'); let size = 0;
      try {
        for await (const chunk of bytes) {
          fence(); signal?.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) fail(400); size += chunk.byteLength; if (size > MAX_BYTES) fail(413);
          hash.update(chunk); await file.writeFile(chunk);
        }
        if (!size) fail(400); const sha256 = hash.digest('hex');
        await file.sync(); await file.close(); fence(); signal?.throwIfAborted();
        const old = await this.store.readJson(id + '.json') as Entry | null;
        if (old) {
          if (signed(old.context) !== signed(context) || old.sha256 !== sha256 || old.size !== size || old.name !== metadata.name || old.type !== metadata.type) fail(409);
          const current = await this.entry(id, context, signal); current.fence();
          return { id, name: old.name, type: old.type, size: old.size };
        }
        await rename(temporary, join(this.store.directory, id + '.bytes'));
        const directory = await open(this.store.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); }
        const entry: Entry = { version: 1, id, context, ...metadata, size, sha256, state: 'retained' };
        fence(); await this.store.writeJson(id + '.json', entry); fence(); signal?.throwIfAborted();
        return { id, ...metadata, size };
      } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
    });
  }
  /** 只交付原 token 确认 committed 且目标内容仍匹配的结果；missing 不是未发送证明。 */
  private async reconcileEntry(value: Entry, services: GatewayRemoteServices, fence: () => void, signal?: AbortSignal): Promise<Uploaded | undefined> {
    if (value.state === 'committed') { fence(); return structuredClone(value.result!); }
    if (!value.operation) return;
    const result = await services.files.queryUpload(value.operation, { signal }); fence();
    if (result.state !== 'committed' || !result.currentMatches || result.size !== value.size || result.sha256 !== value.sha256) return;
    value.result = { path: value.operation.token.path as string, name: value.name, type: value.type, size: value.size };
    value.state = 'committed'; await this.store.writeJson(value.id + '.json', value); fence(); signal?.throwIfAborted();
    return structuredClone(value.result);
  }
  async reconcile(id: string, context: OperationContext, signal?: AbortSignal): Promise<Uploaded | undefined> {
    this.check(id);
    return this.store.withInitialization('attachment-' + id, async () => {
      const { value, fence } = await this.entry(id, context, signal);
      if (value.state === 'committed') { fence(); return structuredClone(value.result!); }
      const services = await this.options.services(context, signal);
      const result = await this.reconcileEntry(value, services, fence, signal); fence(); return result;
    });
  }
  async upload(id: string, context: OperationContext, signal?: AbortSignal): Promise<Uploaded> {
    this.check(id);
    return this.store.withInitialization('attachment-' + id, async () => {
      const { value, fence } = await this.entry(id, context, signal);
      if (value.state === 'committed') { fence(); return structuredClone(value.result!); }
      const services = await this.options.services(context, signal); fence();
      if (!(services instanceof GatewayRemoteServices)) throw new TypeError('需要真实目标消费者');
      if (value.state === 'uploading') {
        const result = await this.reconcileEntry(value, services, fence, signal); if (!result) fail(503); fence(); return result;
      }
      const file = await open(join(this.store.directory, id + '.bytes'), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== value.size || (stat.mode & 0o777) !== 0o600 || (process.getuid && stat.uid !== process.getuid())) fail(503);
        const path = await services.uploadPath(id, extname(value.name).slice(0, 19).replace(/[^.a-zA-Z0-9_-]/g, ''), signal); fence();
        value.state = 'uploading'; await this.store.writeJson(id + '.json', value); fence();
        const uploaded = await services.files.uploadTracked(path, file.createReadStream({ autoClose: false, highWaterMark: 512 * 1024, signal }),
          { size: value.size, sha256: value.sha256, expectedVersion: null, signal, timeoutMs: 180000 }, async operation => {
            fence(); value.operation = operation; await this.store.writeJson(id + '.json', value); fence();
          });
        fence(); value.state = 'committed'; value.result = { path: uploaded.path, size: uploaded.size, name: value.name, type: value.type };
        await this.store.writeJson(id + '.json', value); fence(); signal?.throwIfAborted();
        return structuredClone(value.result);
      } finally { await file.close(); }
    });
  }
}
