import { join, posix, win32 } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ResolvedRemoteTarget, TargetResolutionError } from './targets.js';
import { RemoteRpcSession } from './remote/rpc-session.js';
import { RemoteCommands } from './remote/commands.js';
import { RemoteFiles } from './remote/files.js';
import { RemoteModelUploadSource } from './remote/model-upload-source.js';
import { remoteRollouts, type RemoteRolloutSource } from './rollout-source.js';
import { remoteMediaFiles, localMediaFiles, type MediaFileReference, type MediaFileSource } from './media-file-source.js';
import { TurnChangeHistory } from './turn-change-history.js';
import { MessageTimestamps } from './message-timestamps.js';
import { MessageWebCitations } from './web-citations.js';
import { InlineImages } from './inline-images.js';
import { TitleSummaries } from './title-summaries.js';
import { readCodexProjectState, RemoteProjectReadError } from './codex-projects.js';
import { runRemoteCleanup, withIndependentRemoteOperation } from './remote/operation-guard.js';
import type { HttpSessionRemoteOptions } from './http-session.js';

/** 一个已证明目标的实际消费者；只创建逻辑管理流，物理 Relay 仍由现有 Runtime 持有。 */
export class GatewayRemoteServices {
  readonly media: MediaFileSource;
  readonly rollouts: RemoteRolloutSource;
  readonly projections: HttpSessionRemoteOptions['projections'];
  readonly sidechatReplay: HttpSessionRemoteOptions['sidechatReplay'];
  readonly titles: TitleSummaries;
  private readonly cacheRoot: string;
  private meter?: Promise<RemoteModelUploadSource>;
  private readonly lifetime = new AbortController();
  private closed = false;
  private projectSnapshot?: Awaited<ReturnType<typeof readCodexProjectState>>;
  private projectRefresh?: Promise<void>;
  private projectSnapshotAt = 0;
  private closing?: Promise<void>;
  private constructor(readonly target: ResolvedRemoteTarget, home: string,
    private session: RemoteRpcSession, readonly commands: RemoteCommands, readonly files: RemoteFiles) {
    this.media = remoteMediaFiles(files, target.descriptor.gatewayId);
    this.rollouts = remoteRollouts(session, commands, target.descriptor.gatewayId);
    this.cacheRoot = join(home, 'codex-mobile-remote-cache', target.descriptor.transportNamespace);
    this.projections = {
      changeHistory: new TurnChangeHistory(home, { session, commands, rollouts: this.rollouts, gatewayId: target.descriptor.gatewayId }),
      timestamps: new MessageTimestamps(home, this.rollouts),
      webCitations: new MessageWebCitations(home, this.rollouts),
      commentary: (threadId, turnIds, signal) => this.rollouts.commentary(threadId, turnIds, signal),
      images: new InlineImages(this.cacheRoot, undefined, { files: this.media, reference: value => this.reference(value) }),
    };
    this.sidechatReplay = { files: this.media, resolveReference: value => this.resolveReference(value) };
    this.titles = new TitleSummaries((signal, options) => target.createManagementSession(signal, options));
    session.once('close', () => { void this.close().catch(() => {}); });
  }
  get ready(): boolean { return !this.closed && this.session.ready; }
  static async create(target: ResolvedRemoteTarget, gatewayHome: string, signal?: AbortSignal): Promise<GatewayRemoteServices> {
    if (!(target instanceof ResolvedRemoteTarget)) throw new TypeError('需要可信 Remote 目标');
    let session: RemoteRpcSession | undefined; let commands: RemoteCommands | undefined; let files: RemoteFiles | undefined;
    try {
      const scope = await target.remoteScope(signal);
      session = await target.createManagementSession(signal);
      commands = await RemoteCommands.create(session, scope, signal);
      files = await RemoteFiles.create(session, scope, signal);
      await target.assertCurrent(signal); signal?.throwIfAborted();
      return new GatewayRemoteServices(target, gatewayHome, session, commands, files);
    } catch (error) {
      await runRemoteCleanup(async () => { await files?.close(); await commands?.close(); if (session) { session.close(); await session.settled(); } });
      throw error;
    }
  }
  private assertOpen(): void { if (this.closed) throw new Error('目标消费者已关闭'); }
  async projectState(signal?: AbortSignal) {
    this.assertOpen(); await this.target.assertCurrent(signal); signal?.throwIfAborted();
    if (Date.now() - this.projectSnapshotAt >= 86400000) this.projectSnapshot = undefined;
    if (!this.projectRefresh) {
      const work = withIndependentRemoteOperation(() => this.assertOpen(), async () => {
        const start = performance.now();
        try {
          const result = await readCodexProjectState('', { session: this.session, commands: this.commands, signal: this.lifetime.signal });
          await this.target.assertCurrent(this.lifetime.signal); this.assertOpen();
          this.projectSnapshot = structuredClone(result); this.projectSnapshotAt = Date.now();
        } catch (error) {
          if (!this.lifetime.signal.aborted) {
            const stage = error instanceof RemoteProjectReadError ? error.stage : "publish";
            const code = error instanceof RemoteProjectReadError || error instanceof TargetResolutionError ? error.code : "unavailable";
            const commandStage = error instanceof RemoteProjectReadError ? error.commandStage : undefined;
            console.warn("Remote 项目目录读取失败", {
              stage, code, ...(commandStage ? { commandStage } : {}), elapsedMs: Math.round(performance.now() - start),
            });
          }
          throw error;
        }
      });
      this.projectRefresh = work;
      void work.finally(() => { if (this.projectRefresh === work) this.projectRefresh = undefined; }).catch(() => {});
    }
    if (!this.projectSnapshot) await this.projectRefresh;
    await this.target.assertCurrent(signal); this.assertOpen(); signal?.throwIfAborted();
    return structuredClone(this.projectSnapshot!);
  }
  async uploadPath(id: string, extension: string, signal?: AbortSignal): Promise<string> {
    this.assertOpen(); await this.target.assertCurrent(signal);
    if (!/^[a-f0-9-]{36}$/i.test(id) || !/^\.?[a-zA-Z0-9_-]{0,19}$/.test(extension)) throw new Error('附件名称无效');
    const paths = this.commands.metadata.platformFamily === 'windows' ? win32 : posix;
    const directory = paths.join(this.commands.metadata.codexHome, 'codex-mobile-uploads');
    const result = await this.commands.execute({ argv: [this.commands.fileTransportBinding(this.session).python, '-c',
      'import os,sys;os.makedirs(sys.argv[1],mode=0o700,exist_ok=True)', directory], cwd: this.commands.metadata.codexHome, signal });
    if (result.exitCode !== 0) throw new Error('无法创建目标附件目录');
    await this.target.assertCurrent(signal); this.assertOpen(); return paths.join(directory, id + extension);
  }
  /** 缓存路径只由服务端编码；远端绝对路径始终交给 RemoteFiles。 */
  private reference(value: MediaFileReference): string {
    this.assertOpen();
    if (value.origin === 'target') {
      if (value.source !== this.media || !this.media.paths.isAbsolute(value.path)) throw new Error('目标引用无效');
      return value.path;
    }
    if (value.source !== localMediaFiles || !value.path.startsWith(this.cacheRoot + '/') ||
      !/^image-[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/.test(value.path.slice(this.cacheRoot.length + 1))) throw new Error('缓存引用无效');
    return `codex-cache:${this.target.descriptor.transportNamespace}:${value.path.slice(this.cacheRoot.length + 1)}`;
  }
  resolveReference(value: string): MediaFileReference | null {
    this.assertOpen();
    const prefix = `codex-cache:${this.target.descriptor.transportNamespace}:`;
    if (value.startsWith(prefix)) {
      const name = value.slice(prefix.length);
      if (/^image-[a-f0-9]{64}\.(png|jpg|gif|webp|avif)$/.test(name)) return { source: localMediaFiles, path: join(this.cacheRoot, name), origin: 'gateway-cache' };
      return null;
    }
    return this.media.paths.isAbsolute(value) && !value.includes('\0') ? { source: this.media, path: value, origin: 'target' } : null;
  }
  /** 缺少目标计量来源时保持 unavailable，由调用者处理，不伪造零值。 */
  uploadMeter(signal?: AbortSignal): Promise<RemoteModelUploadSource> {
    this.assertOpen();
    if (!this.meter) {
      const cancel = () => controller.abort(signal?.reason);
      const controller = new AbortController();
      const closed = () => controller.abort(this.lifetime.signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      this.lifetime.signal.addEventListener('abort', closed, { once: true });
      if (signal?.aborted) cancel();
      const pending = RemoteModelUploadSource.create(this.session, this.commands, { signal: controller.signal })
        .finally(() => signal?.removeEventListener('abort', cancel)); this.meter = pending;
      void pending.catch(() => { if (this.meter === pending) this.meter = undefined; });
    }
    return this.meter;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.lifetime.abort(); this.titles.close();
    this.closing = runRemoteCleanup(async () => {
      const failures: unknown[] = [];
      const finish = async (operation: () => Promise<unknown>) => { try { await operation(); } catch (error) { failures.push(error); } };
      await this.projectRefresh?.catch(() => {});
      const meter = await this.meter?.catch(() => undefined); await finish(async () => meter?.close());
      await finish(() => this.rollouts.close()); await finish(() => this.files.close()); await finish(() => this.commands.close());
      this.session.close(); await finish(() => this.session.settled());
      if (failures.length) throw new AggregateError(failures, '目标消费者收尾失败');
    });
    return this.closing;
  }
}
