import { RemoteReadSnapshots } from './remote-read-snapshots.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { OperationQueue, OperationQueueError, followUpMessage, FOLLOW_UP_TURN_EXPIRED_ERROR, type OperationAuthorizationFence, type OperationClaim, type OperationContext, type OperationControl, type OperationReceipt, type OperationRecord } from './operation-queue.js';
import { HttpSessions, HOSTED_SESSION_ID, isReadOnlyRpc, readOriginalOperation, type HttpSessionRemoteOptions, type PublicRpcEnvelope, type RpcMessage, type SessionCallOptions, type SessionDispatchAttempt, type SessionDispatchResult } from './http-session.js';
import { isNavigationResume, rpcSignatureInput, rpcControlRequestKey } from './rpc-replay.js';
import { TargetResolver, type ResolvedRemoteTarget } from './targets.js';
import { assertRemoteOperation, captureRemoteOperation, withIndependentRemoteOperation, withRemoteOperation } from './remote/operation-guard.js';
import { QueueError, canonical, validateText, validateInputs, validateSettings, type RecordItem } from './follow-ups.js';
import { messageAttachmentCount } from './user-message-format.js';
import type { GatewayAttachments } from './gateway-attachments.js';

type Action = Parameters<TargetResolver['authorizeOperation']>[1];
interface RpcInitialization { message: RpcMessage; notification?: RpcMessage }
interface RpcBody { kind: 'rpc-v1'; sessionId: string; requestId: string; message: RpcMessage; epoch?: string; initialization?: RpcInitialization }
export interface QueuedRpcInput {
  id: string; context: OperationContext; conversationId: string; sessionId: string; requestId: string;
  message: RpcMessage; settings: unknown; attachmentRefs: string[]; epoch?: string; control?: OperationControl;
}
interface Options {
  directory: string; gatewayId: string; gatewayCodexHome: string; resolver: TargetResolver; upstreamUrl: string;
  remoteConsumers: (context: Readonly<OperationContext>, target: ResolvedRemoteTarget, call: SessionCallOptions) =>
    RemoteSessionConsumers | Promise<RemoteSessionConsumers>;
  localSessions?: HttpSessions;
  onResponse?: (context: Readonly<OperationContext>, message: RpcMessage, response: RpcMessage, sessionId: string) => Promise<void>;
  onEvents?: (context: Readonly<OperationContext>, sessionId: string, events: { messages: RpcMessage[]; requests: RpcMessage[] }) => void;
  onSessions?: (context: Readonly<OperationContext>, sessions: HttpSessions) => void;
  attachments?: GatewayAttachments;
  attemptTimeoutMs?: number; scanIntervalMs?: number;
}
type RemoteSessionConsumers = Pick<HttpSessionRemoteOptions, 'projections' | 'sidechatReplay' | 'isAvailable'> &
  Pick<ConstructorParameters<typeof HttpSessions>[0], 'notifications' | 'uploadMeter' | 'titleSummary'>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SIDECHAT = 'c0dec000-0000-4000-8000-000000000002';
function key(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(key).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${key(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function body(record: Readonly<OperationRecord>): RpcBody | undefined {
  if (!record.rpcReceipt) return; // 旧合法未知body保留写屏障，不猜成可信RPC。
  if (record.followUp) { const message = followUpMessage(record); return message ? { kind: 'rpc-v1', sessionId: record.rpcReceipt.sessionId, requestId: record.rpcReceipt.requestId, message } : undefined; }
  const value = record.body as RpcBody | undefined;
  if (!value || value.kind !== 'rpc-v1' || !UUID.test(value.sessionId) || value.sessionId === SIDECHAT || !UUID.test(value.requestId) || !value.message || typeof value.message !== 'object' || Array.isArray(value.message)) return;
  return value;
}
function isRead(record: Readonly<OperationRecord>): boolean { const rpc = body(record); return !!rpc && !record.control && isReadOnlyRpc(rpc.message); }
function isBackground(record: Readonly<OperationRecord>): boolean { return isRead(record) && (record.settings as any)?.source === 'gateway-observer-v1'; }
// 仅已放弃执行的精确未发送claim清理事实；无正文、无新耐久owner，同进程重建可接续原授权CAS。
const abandonedClaims = new Map<string, { directory: string; gatewayId: string; claim: OperationClaim; pending?: Promise<void> }>();

/** 公开 RPC、托管业务和追问共用的唯一耐久调度 owner。 */
export class OperationScheduler {
  readonly snapshots = new RemoteReadSnapshots();
  readonly #options: Options;
  readonly #queue: OperationQueue;
  readonly #authorization = new AsyncLocalStorage<Map<string, OperationAuthorizationFence | unknown>>();
  readonly #controllers = new Set<AbortController>();
  readonly #dispatchClaims = new Map<string, string>();
  readonly #calls = new Set<Promise<unknown>>();
  readonly #sessions = new Map<string, HttpSessions>();
  readonly #sessionOpenings = new Map<string, Promise<HttpSessions>>();
  readonly #initializations = new Map<string, RpcInitialization>();
  readonly #results = new Map<string, SessionDispatchResult>();
  readonly #readReconciliations = new Map<string, { revision: number; after: number }>();
  readonly #diagnostics = new Map<string, unknown>();
  readonly #resumed = new Map<string, string>();
  readonly #resuming = new Map<string, { epoch: string; promise: Promise<void> }>();
  readonly #hostedReads = new Map<string, Promise<RpcMessage>>();
  readonly #operationWaiters = new Map<string, Set<() => void>>();
  readonly #hostedQueued = new Map<string, string>();
  #closed = false;
  #running?: Promise<void>;
  #closing?: Promise<void>;
  #timer?: NodeJS.Timeout;
  #wakeup?: () => void;
  lastError?: unknown;
  constructor(options: Options) {
    if (!(options.resolver instanceof TargetResolver) || !options.gatewayCodexHome || !options.upstreamUrl ||
      !Number.isFinite(options.attemptTimeoutMs ?? 60_000) || (options.attemptTimeoutMs ?? 60_000) <= 0 ||
      !Number.isFinite(options.scanIntervalMs ?? 1000) || (options.scanIntervalMs ?? 1000) <= 0) throw new TypeError('需要可信resolver、显式网关目录和有界预算');
    this.#options = { ...options, directory: resolve(options.directory) };
    this.#queue = new OperationQueue({ directory: options.directory, gatewayId: options.gatewayId, authorize: async (context, action) => {
      const value = this.#authorization.getStore()?.get(key([context, action]));
      if (typeof value !== 'function') throw value ?? new Error('操作未按原context/action预授权');
      return value as OperationAuthorizationFence;
    } });
  }
  private assertOpen(): void { if (this.#closed) throw new Error('RPC调度器已关闭'); }
  // 关闭等待本实例所有已启动入口，包括尚未创建Session的真实授权/磁盘等待。
  private own<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const settled = new Promise<void>(resolve => { release = resolve; }); this.#calls.add(settled);
    const done = () => { this.#calls.delete(settled); release(); };
    try {
      this.assertOpen(); const pending = operation();
      void pending.then(done, done);
      return pending; // 返回原入口Promise，不在最终交付fence后添加新的await包装。
    } catch (error) { done(); return Promise.reject(error); }
  }
  submit(input: QueuedRpcInput, call?: SessionCallOptions): Promise<OperationReceipt> { return this.own(() => this.submitRpc(input, call)); }
  protocol(input: { context: OperationContext; sessionId: string; requestId: string; message: RpcMessage }, original?: SessionCallOptions) { return this.own(() => this.protocolRpc(input, original)); }
  events(context: OperationContext, sessionId: string, after: number, original?: SessionCallOptions) { return this.own(() => this.sessionEvents(context, sessionId, after, original)); }
  result(id: string, original?: SessionCallOptions): Promise<SessionDispatchResult> { return this.own(() => this.readResult(id, original)); }
  /** 本地只读复用原 Session 的瞬态幂等缓存，不触碰共享耐久账本。 */
  localRead(context: OperationContext, sessionId: string, envelope: PublicRpcEnvelope, original: SessionCallOptions): Promise<RpcMessage> {
    if (context.mode !== 'local' || !isReadOnlyRpc(envelope.message)) throw new TypeError('本地读取入口只允许可信只读方法');
    return this.own(() => this.budget(async call => {
      const sessions = await this.sessions(context, call);
      const response = await sessions.publicRpc(sessionId, envelope, call);
      if (envelope.message.method === 'thread/resume' && response.error == null && this.#options.onResponse) {
        // 观察登记归网关持有，手机返回或断开不等待其磁盘写入；close 仍等待它结束。
        void this.own(() => withIndependentRemoteOperation(() => this.assertOpen(), async () => {
          await this.#options.onResponse!(context, envelope.message, response, sessionId);
        })).catch(error => { this.lastError = error; });
      }
      return response;
    }, original));
  }
  operation(id: string, routeContext: OperationContext, sessionId: string, original?: SessionCallOptions, expected?: { message: RpcMessage; epoch?: string }) {
    routeContext = structuredClone(routeContext);
    expected = expected ? structuredClone(expected) : undefined;
    return this.own(async () => {
      let delivery = () => {};
      const value = await this.budget(async call => {
        const context = await this.#queue.locate(id);
        const route = (value: OperationContext) => value.mode === 'local' ? value :
          { mode: value.mode, gatewayId: value.gatewayId, businessKey: value.businessKey, managed: value.managed, target: value.target };
        if (key(route(context)) !== key(route(routeContext))) throw new OperationQueueError('rpc-binding-conflict', 409);
        const { record, dispatching } = await this.ledger([context], ['read'], call, async () => {
          const claimToken = this.#dispatchClaims.get(id);
          const record = await this.#queue.read(id);
          // 与原记录一并冻结在途快照，后续授权等待期间完成也不能误报unknown。
          const dispatching = record.state === 'uncertain' && !!record.claimToken &&
            (claimToken === record.claimToken || this.#dispatchClaims.get(id) === record.claimToken);
          return { record, dispatching };
        });
        if (record.rpcReceipt?.sessionId !== sessionId || record.rpcReceipt.requestId !== id) throw new OperationQueueError('rpc-binding-conflict', 409);
        if (expected && (record.rpcReceipt.submissionSignature ?? record.rpcReceipt.signature) !== createHash('sha256').update(rpcSignatureInput(expected.message, expected.epoch)).digest('hex')) throw new OperationQueueError('rpc-binding-conflict', 409);
        let response: RpcMessage | undefined;
        if (['succeeded', 'failed'].includes(record.state) && !record.failure) {
          const result = await this.readResult(id, call, record); if (result.outcome === 'response') response = result.message;
        }
        if (record.failure === 'control-expired') response = { error: { code: -32001, message: '原控制已过期，未发送' } };
        if (record.state === 'cancelled') response = { error: { code: -32800, message: '未发送的操作已取消' } };
        const fence = await this.#options.resolver.authorizeOperation(context, 'read', call.signal);
        delivery = () => { fence(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('操作查询预算已结束'); };
        const value = { status: response ? 'completed' : ['queued', 'claimed'].includes(record.state) || dispatching ? 'pending' : 'uncertain',
          operation: { id: record.id, revision: record.revision, state: record.state, receiveOrder: record.receiveOrder },
          ...(response ? { message: response } : {}) };
        delivery(); return value;
      }, original);
      delivery(); assertRemoteOperation(); return value;
    });
  }
  /** 后台业务读取复用相同在途项；只由服务器赋予后台等级。 */
  hostedRpc(context: OperationContext, message: RpcMessage, original?: SessionCallOptions): Promise<RpcMessage> {
    if (!isReadOnlyRpc(message)) throw new TypeError('后台入口只允许可信只读方法');
    const binding = key([context, { ...message, id: undefined }]);
    const current = this.#hostedReads.get(binding); if (current) return current;
    const work = this.own(() => this.budget(async call => {
      if (context.mode === 'local') return (await this.sessions(context, call)).hostedRpc(message, randomUUID(), call);
      let id = this.#hostedQueued.get(binding);
      if (!id) {
        const groups = await this.#queue.inventory();
        for (const group of groups.filter(group => key(group.context) === key(context))) {
          for (const receipt of group.operations.filter(receipt => receipt.state === 'queued')) {
            const record = await this.ledger([context], ['read'], call, () => this.#queue.read(receipt.id)); const rpc = body(record);
            if ((record.settings as any)?.source === 'gateway-observer-v1' && rpc && key({ ...rpc.message, id: undefined }) === key({ ...message, id: undefined })) { id = record.id; break; }
          }
          if (id) break;
        }
      }
      if (!id) {
        id = randomUUID();
        await this.submit({ id, context, conversationId: typeof message.params?.threadId === 'string' ? message.params.threadId : '__gateway__',
          sessionId: HOSTED_SESSION_ID, requestId: id, message: { ...message, id }, settings: { source: 'gateway-observer-v1' }, attachmentRefs: [] }, call);
      }
      this.#hostedQueued.set(binding, id);
      void this.runOnce().catch(() => {});
      let lastState: string | undefined;
      try {
      for (;;) {
        const waiting = this.waitForOperation(id, call);
        try {
          const state = await this.operation(id, context, HOSTED_SESSION_ID, call);
          lastState = state.status;
          if (state.status === 'completed') { this.#hostedQueued.delete(binding); return state.message!; }
          if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('后台读取待恢复');
          await waiting.promise;
        } finally { waiting.dispose(); }
      }
      } finally {
        // 仅在原等待预算结束后允许下一次独立只读查询；未知写入从不重放。
        if (lastState === 'uncertain') this.#hostedQueued.delete(binding);
      }
    }, original));
    this.#hostedReads.set(binding, work);
    void work.finally(() => { if (this.#hostedReads.get(binding) === work) this.#hostedReads.delete(binding); }).catch(() => {});
    return work;
  }
  private waitForOperation(id: string, call: SessionCallOptions) {
    let wake!: () => void;
    const promise = new Promise<void>(resolve => { wake = resolve; });
    let waiters = this.#operationWaiters.get(id);
    if (!waiters) { waiters = new Set(); this.#operationWaiters.set(id, waiters); }
    waiters.add(wake);
    // 先注册再查原账本，避免完成发生在查询与开始等待之间；跨进程仍有界复查。
    const timer = setTimeout(wake, Math.min(1000, Math.max(0, call.deadline - performance.now()))); timer.unref();
    call.signal?.addEventListener('abort', wake, { once: true });
    if (call.signal?.aborted) wake();
    return { promise, dispose: () => {
      clearTimeout(timer); call.signal?.removeEventListener('abort', wake); waiters.delete(wake);
      if (!waiters.size && this.#operationWaiters.get(id) === waiters) this.#operationWaiters.delete(id);
    } };
  }
  private wakeOperation(id: string) { for (const wake of this.#operationWaiters.get(id) ?? []) wake(); }
  hasPending(context: OperationContext, threadId: string, original?: SessionCallOptions): Promise<boolean> {
    return this.own(() => this.budget(async call => {
      const groups = await this.#queue.inventory();
      const contexts = groups.filter(group => group.context.businessKey === context.businessKey && group.conversationId === threadId).map(group => group.context);
      // 只交付责任布尔值，不读取其他授权组的正文。
      const fence = await this.#options.resolver.authorizeOperation(context, 'read', call.signal); fence();
      return contexts.length > 0;
    }, original));
  }
  sessionsForTarget(context: OperationContext, call: SessionCallOptions): Promise<HttpSessions> { return this.own(() => this.sessions(context, call)); }
  cancelNavigation(id: string, revision: number, context: OperationContext): Promise<OperationReceipt> { return this.own(() => this.cancelQueuedNavigation(id, revision, context)); }
  openFollowUps(codexHome: string, captureDelivery?: (fence: () => void) => void): Promise<OperationContext> {
    return this.own(async () => {
      const parents = captureRemoteOperation(); let final = () => {};
      const result = await this.budget(async call => {
      const home = await realpath(codexHome); if (home !== await realpath(this.#options.gatewayCodexHome)) throw new QueueError(409, '追问来源与原网关目录不一致');
      const context = await this.#options.resolver.operationContext(undefined, call.signal);
      const source = join(home, 'codex-mobile-follow-ups', 'queue.json');
      await this.ledger([context], ['submit'], call, () => this.#queue.importFollowUps(source, context, async () => {
        let bytes: Buffer; try { bytes = await readFile(source); } catch (error: any) { if (error.code !== 'ENOENT') throw error; bytes = Buffer.from('{"version":1,"records":[]}'); }
        if (bytes.length > 64 * 1024 * 1024) throw new QueueError(507, '追问持久化存储已满');
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!data || Object.keys(data).some(name => !['version', 'records'].includes(name)) || data.version !== 1 || !Array.isArray(data.records) || data.records.length > 65_536) throw new QueueError(503, '旧追问存储无效');
        for (const item of data.records) {
          if (!item || Object.keys(item).some(name => !['id', 'fingerprint', 'threadId', 'state', 'revision', 'inputText', 'text', 'attachmentCount', 'extraInput', 'settings', 'operationId', 'restoreState', 'method', 'error'].includes(name)) || typeof item.id !== 'string' || !UUID.test(item.id) || typeof item.operationId !== 'string' || !UUID.test(item.operationId) || typeof item.threadId !== 'string' || !item.threadId.trim() || !['queued', 'sending', 'failed', 'uncertain', 'sent', 'cancelled'].includes(item.state) || !Number.isSafeInteger(item.revision) || item.revision < 1 || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint) || (item.method !== undefined && !['turn/start', 'turn/steer'].includes(item.method)) || (item.restoreState !== undefined && !['queued', 'failed'].includes(item.restoreState)) || (item.error !== undefined && typeof item.error !== 'string')) throw new QueueError(503, '旧追问记录无效');
          if (!['sent', 'cancelled'].includes(item.state) || item.inputText !== undefined || item.text !== undefined) validateText(item.inputText, item.text);
          if (!['sent', 'cancelled'].includes(item.state) || item.extraInput !== undefined) validateInputs(item.extraInput);
          if (!['sent', 'cancelled'].includes(item.state) || item.settings !== undefined) validateSettings(item.settings);
          if ((!['sent', 'cancelled'].includes(item.state) || item.attachmentCount !== undefined) && (!Number.isSafeInteger(item.attachmentCount) || item.attachmentCount < 0 ||
            ((item.inputText !== undefined && item.extraInput !== undefined) && item.attachmentCount !== messageAttachmentCount(item.inputText, item.extraInput)))) throw new QueueError(503, '旧追问附件数量无效');
        }
        return { records: data.records as RecordItem[], sha256: createHash('sha256').update(bytes).digest('hex') };
      }));
      const fence = await this.#options.resolver.authorizeOperation(context, 'submit', call.signal);
      final = () => { fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('接管原预算已结束'); };
      final(); return context;
      });
      final(); captureDelivery?.(final); final(); assertRemoteOperation(); return result;
    });
  }
  private async followUpCall<T>(context: OperationContext, actions: Action[], operation: (call: SessionCallOptions) => Promise<T>, captureDelivery?: (fence: () => void) => void): Promise<T> {
    context = structuredClone(context); const parents = captureRemoteOperation(); let final = () => {};
    const value = await this.budget(async call => {
      const contexts = [context, ...await this.#queue.contexts(context.businessKey)];
      const result = await this.ledger(contexts, actions, call, () => operation(call));
      const fences = await Promise.all(contexts.map(value => this.#options.resolver.authorizeOperation(value, 'read', call.signal)));
      final = () => { for (const fence of fences) fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('追问原预算已结束'); };
      final(); return result;
    });
    final(); captureDelivery?.(final); final(); assertRemoteOperation(); return value;
  }
  publicQueue(context: OperationContext, threadId?: string, captureDelivery?: (fence: () => void) => void) {
    return this.own(() => this.followUpCall(context, ['read'], async () => {
      const records = await this.#queue.publicRecords(context.businessKey, threadId);
      return { items: records.filter(record => !record.followUp && ((record.settings as any)?.source === 'public-rpc-v1' || record.createdThreadId)).map(record => {
        const rpc = body(record);
        return { id: record.id, revision: record.revision, receiveOrder: record.receiveOrder, state: record.state,
          threadId: record.createdThreadId ?? record.conversationId, method: rpc?.message.method ?? record.rpcReceipt?.method,
          ...(rpc ? { params: rpc.message.params } : {}), ...(record.createdThreadId ? { pendingId: record.conversationId } : {}) };
      }) };
    }, captureDelivery));
  }
  mutatePublicQueue(context: OperationContext, input: { action: string; id: string; revision: number; inputText?: string }, captureDelivery?: (fence: () => void) => void) {
    input = structuredClone(input);
    return this.own(() => this.followUpCall(context, ['read', 'edit', 'cancel'], async () => {
      if (!UUID.test(input.id) || !Number.isSafeInteger(input.revision)) throw new QueueError(400, '操作 ID 或版本无效');
      const record = await this.#queue.read(input.id); const rpc = body(record);
      if (record.context.businessKey !== context.businessKey || !rpc || record.followUp || (record.settings as any)?.source !== 'public-rpc-v1') throw new QueueError(409, '操作归属或状态已变化');
      if (input.action === 'cancel') await this.#queue.cancel(input.id, input.revision);
      else if (input.action === 'edit' && rpc.message.method === 'turn/start') {
        validateText(input.inputText, input.inputText);
        const retained = Array.isArray(rpc.message.params?.input) ? rpc.message.params.input.filter((part: any) => part.type !== 'text') : [];
        if (!input.inputText?.trim() && !retained.length) throw new QueueError(400, '消息不能为空');
        const updated = { ...rpc, message: { ...rpc.message, params: { ...rpc.message.params, input: [...(input.inputText ? [{ type: 'text', text: input.inputText, text_elements: [] }] : []), ...retained] } } };
        await this.#queue.edit(input.id, input.revision, { body: updated });
      } else throw new QueueError(400, '不支持的队列操作');
      return { saved: true };
    }, captureDelivery));
  }
  listFollowUps(context: OperationContext, captureDelivery?: (fence: () => void) => void): Promise<{ items: unknown[] }> {
    context = structuredClone(context);
    return this.own(() => this.followUpCall(context, ['read'], async call => this.followUpList(await this.#queue.listFollowUps(context), call), captureDelivery));
  }
  followUpSubmission(context: OperationContext, id: string, captureDelivery?: (fence: () => void) => void) {
    return this.own(() => this.followUpCall(context, ['read'], async () => {
      if (!UUID.test(id)) throw new QueueError(400, '追问 ID 必须为 UUID');
      const record = await this.#queue.read(id);
      if (!record.followUp || record.context.businessKey !== context.businessKey) throw new QueueError(409, '追问归属不一致');
      return { accepted: true, operation: { id: record.id, state: record.state, revision: record.revision } };
    }, captureDelivery));
  }
  private async followUpList(records: OperationRecord[], call: SessionCallOptions): Promise<{ items: unknown[] }> {
    const items: unknown[] = [];
    for (const record of records.filter(record => !['succeeded', 'cancelled'].includes(record.state))) {
      const follow = record.followUp!; const payload = record.body as { inputText?: string };
      let error = follow.error ?? (record.state === 'uncertain' && !follow.legacyRecovery ? '发送结果待确认，请检查会话，勿重复发送' : undefined);
      if (record.state === 'failed' && (record.rpcReceipt || follow.walError) && error === undefined) {
        const message = followUpMessage(record);
        const stored = await readOriginalOperation({ gatewayCodexHome: this.#options.gatewayCodexHome, resolver: this.#options.resolver, context: record.context,
          sessionId: record.rpcReceipt?.sessionId ?? 'c0dec000-0000-4000-8000-000000000001', requestId: follow.operationId,
          ...(record.rpcReceipt ? { expectedSignature: record.rpcReceipt.signature, ...(message ? { expected: { message } } : {}) } : {}), call });
        if (stored.status !== 'completed' || stored.message?.error == null) throw new QueueError(503, '原追问错误结果不可读取');
        error = String((stored.message.error as any)?.message ?? '追问发送失败');
      }
      items.push({ id: record.id, threadId: record.conversationId, inputText: payload?.inputText, text: follow.text, attachmentCount: follow.attachmentCount,
        state: follow.legacyRecovery || record.state === 'claimed' || (record.state === 'queued' && follow.expectedTurnId) ? 'sending' : record.state, revision: record.revision, ...(error !== undefined ? { error } : {}) });
    }
    return { items };
  }
  mutateFollowUp(context: OperationContext, body: any, captureDelivery?: (fence: () => void) => void): Promise<{ items: unknown[]; turnId?: string }> {
    context = structuredClone(context); body = structuredClone(body);
    return this.own(() => this.followUpCall(context, ['read', 'submit', 'edit', 'cancel', 'transition'], async call => {
      if (!body || typeof body !== 'object' || typeof body.id !== 'string' || !UUID.test(body.id)) throw new QueueError(400, '追问 ID 必须为 UUID');
      if (body.action === 'enqueue') {
        validateText(body.inputText, body.text); validateInputs(body.extraInput); validateSettings(body.settings);
        if (typeof body.threadId !== 'string' || !body.threadId.trim() || body.threadId.length > 256) throw new QueueError(400, '会话 ID 无效');
        const content = { threadId: body.threadId, inputText: body.inputText, text: body.text, attachmentCount: messageAttachmentCount(body.inputText, body.extraInput), extraInput: body.extraInput, settings: body.settings };
        if (body.attachmentCount !== content.attachmentCount) throw new QueueError(400, '附件数量与输入不一致');
        if (!body.inputText.trim() && !body.extraInput.length) throw new QueueError(400, '追问不能为空');
        await this.#queue.enqueueFollowUp(context, { ...content, id: body.id, fingerprint: createHash('sha256').update(canonical(content)).digest('hex'), operationId: randomUUID(), revision: 1, state: 'queued' });
      } else {
        const record = await this.#queue.read(body.id); if (!record.followUp || record.context.businessKey !== context.businessKey) throw new QueueError(409, '追问身份冲突');
        if (!Number.isSafeInteger(body.revision)) throw new QueueError(400, '追问 revision 无效');
        if (!['edit', 'cancel', 'retry', 'steer'].includes(body.action)) throw new QueueError(400, '不支持的追问操作');
        if (record.state === 'queued' && record.followUp.expectedTurnId) throw new QueueError(409, '引导已绑定原回合，正在发送');
        if (body.action === 'edit') { validateText(body.inputText, body.text); validateInputs(body.mentions, true); }
        if (record.revision !== body.revision || !(['retry', 'steer'].includes(body.action) ? ['queued', 'failed'].includes(record.state) : record.state === 'queued')) throw new QueueError(409, '追问状态或版本已变更');
        const status = body.action === 'steer' ? await this.inspectFollowUp(record, call, true) : undefined;
        if (status && !status.turnId) throw new QueueError(409, '当前会话没有可插入的运行回合');
        await this.#queue.changeFollowUp(body.id, body.revision, ['edit', 'cancel'].includes(body.action) ? body.action : 'transition', current => {
          if (body.action === 'retry' || body.action === 'steer') {
            if (body.action === 'retry' && current.state !== 'failed') throw new QueueError(409, '只能重试失败追问');
            current.state = 'queued'; current.followUp!.operationId = randomUUID(); delete current.rpcReceipt; delete current.claimToken; delete current.claimPid;
            delete current.followUp!.error; delete current.followUp!.legacyRecovery; delete current.followUp!.walError;
            current.followUp!.method = body.action === 'steer' ? 'turn/steer' : undefined; current.followUp!.expectedTurnId = status?.turnId;
            current.followUp!.restoreState = body.action === 'steer' ? record.state as 'queued' | 'failed' : undefined; return;
          }
          if (body.action === 'cancel') { current.state = 'cancelled'; delete current.followUp!.text; delete current.followUp!.attachmentCount; return; }
          const payload = current.body as { inputText: string; extraInput: Record<string, unknown>[] };
          const extraInput = [...(payload.extraInput ?? []).filter(entry => !['skill', 'mention'].includes(String(entry.type))), ...body.mentions];
          validateInputs(extraInput);
          if (!body.inputText.trim() && !extraInput.length) throw new QueueError(400, '追问不能为空');
          current.body = { kind: 'follow-up-v1', inputText: body.inputText, extraInput }; current.followUp!.text = body.text;
          current.followUp!.attachmentCount = messageAttachmentCount(body.inputText, extraInput);
          if (current.rpcReceipt) current.rpcReceipt.signature = createHash('sha256').update(rpcSignatureInput(followUpMessage(current)!)).digest('hex');
        });
        this.#wakeup?.();
        if (body.action === 'steer') {
          await this.runOnce(); const current = await this.#queue.read(body.id);
          if (current.state === 'failed' && !current.rpcReceipt) throw new QueueError(409, current.followUp!.error ?? '原运行回合已失效');
          const result = await this.readResult(body.id, call);
          if (result.outcome !== 'response') throw new QueueError(503, '引导结果待确认');
          if (result.message.error != null) throw new QueueError(503, String((result.message.error as any)?.message ?? '追问发送失败'));
          return { ...await this.followUpList(await this.#queue.listFollowUps(context), call), turnId: (result.message.result as any)?.turnId ?? (result.message.result as any)?.turn?.id ?? status!.turnId };
        }
      }
      return this.followUpList(await this.#queue.listFollowUps(context), call);
    }, captureDelivery));
  }
  private async inspectFollowUp(record: OperationRecord, call: SessionCallOptions, needTurn = false): Promise<{ active: boolean; turnId?: string }> {
    const sessions = await this.sessions(record.context, call); const epoch = await sessions.hostedReady(call); this.assertOpen();
    const binding = key([record.context, record.conversationId]);
    if (this.#resumed.get(binding) !== epoch) {
      let resuming = this.#resuming.get(binding);
      if (resuming?.epoch !== epoch) {
        const promise = this.own(async () => {
          const resumed = await sessions.hostedRpc({ id: randomUUID(), method: 'thread/resume', params: { threadId: record.conversationId, excludeTurns: true, initialTurnsPage: { limit: 1, itemsView: 'summary' } } }, randomUUID(), call);
          if (resumed.error != null) throw new QueueError(503, String((resumed.error as any)?.message ?? '无法恢复会话'));
          const currentEpoch = await sessions.hostedReady(call);
          this.assertOpen(); assertRemoteOperation();
          if (call.signal?.aborted || performance.now() >= call.deadline || currentEpoch !== epoch) throw new QueueError(503, '原会话恢复预算或连接已失效');
          this.#resumed.set(binding, epoch);
        });
        resuming = { epoch, promise }; this.#resuming.set(binding, resuming);
        const pending = resuming; const done = () => { if (this.#resuming.get(binding) === pending) this.#resuming.delete(binding); };
        void promise.then(done, done);
      }
      const pending = resuming;
      // 共用原恢复过程，等待者仍按自己的原预算退出；实际恢复由own跟踪到settled。
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new QueueError(503, '原会话恢复等待已取消或超时'));
        call.signal?.addEventListener('abort', abort, { once: true });
        if (call.signal?.aborted || performance.now() >= call.deadline) abort();
        void pending.promise.then(resolve, reject).finally(() => call.signal?.removeEventListener('abort', abort));
      });
    }
    const read = await sessions.hostedRpc({ id: randomUUID(), method: 'thread/read', params: { threadId: record.conversationId, includeTurns: false } }, randomUUID(), call);
    if (read.error != null) throw new QueueError(503, String((read.error as any)?.message ?? '无法读取会话'));
    const thread = (read.result as any)?.thread; if (!thread || thread.id !== record.conversationId) throw new QueueError(503, '无法确认会话运行状态');
    const status = thread.status?.type ?? thread.status;
    if (['idle', 'notLoaded', 'systemError'].includes(status)) return { active: false };
    if (status !== 'active') throw new QueueError(503, '无法确认会话运行状态');
    if (!needTurn) return { active: true };
    const turns = await sessions.hostedRpc({ id: randomUUID(), method: 'thread/turns/list', params: { threadId: record.conversationId, limit: 1, sortDirection: 'desc', itemsView: 'summary' } }, randomUUID(), call);
    if (turns.error != null || !Array.isArray((turns.result as any)?.data)) throw new QueueError(503, '无法确认运行回合');
    const turn = (turns.result as any).data.find((entry: any) => ['inProgress', 'in_progress', 'running'].includes(entry.status));
    return { active: true, turnId: turn?.id };
  }
  private async budget<T>(operation: (call: SessionCallOptions) => Promise<T>, original?: SessionCallOptions, executionBudgetMs = this.#options.attemptTimeoutMs ?? 60_000): Promise<T> {
    original = original ? { deadline: original.deadline, signal: original.signal } : undefined;
    if (original && !Number.isFinite(original.deadline)) throw new TypeError('需要有限的原调用deadline');
    const controller = new AbortController(); this.#controllers.add(controller);
    const deadline = Math.min(original?.deadline ?? Infinity, performance.now() + executionBudgetMs);
    const abort = () => controller.abort(original?.signal?.reason);
    original?.signal?.addEventListener('abort', abort, { once: true }); if (original?.signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('RPC调度预算到期')), Math.max(0, deadline - performance.now())); timer.unref();
    const call = { deadline, signal: controller.signal };
    try { return await withRemoteOperation(() => { this.assertOpen(); if (controller.signal.aborted || performance.now() >= deadline) throw new Error('RPC调度预算到期或取消'); }, () => operation(call)); }
    finally { clearTimeout(timer); original?.signal?.removeEventListener('abort', abort); this.#controllers.delete(controller); }
  }
  // 所有异步身份核验在ledger锁外；事务中只核验完整context/action绑定的真实同步fence。
  private async ledger<T>(contexts: Readonly<OperationContext>[], actions: Action[], call: SessionCallOptions, operation: () => Promise<T>): Promise<T> {
    const checks = new Map<string, OperationAuthorizationFence | unknown>();
    for (const context of new Map(contexts.map(value => [key(value), value])).values()) {
      for (const action of actions) {
        const binding = key([context, action]);
        try {
          const fence = await this.#options.resolver.authorizeOperation(context as OperationContext, action, call.signal);
          checks.set(binding, () => { this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('RPC调度预算到期或取消'); fence(); });
        } catch (error) { checks.set(binding, error); }
      }
    }
    this.assertOpen();
    return this.#authorization.run(checks, operation);
  }
  private async submitRpc(input: QueuedRpcInput, call?: SessionCallOptions): Promise<OperationReceipt> {
    this.assertOpen();
    if (input.sessionId === SIDECHAT || input.message?.method?.startsWith('mobile/sidechat/') || ['initialize', 'initialized', 'rpc.ping', 'rpc.pong'].includes(input.message?.method ?? '')) throw new TypeError('Sidechat或传输帧不得进入RPC业务ledger');
    if (!UUID.test(input.sessionId) || !UUID.test(input.requestId)) throw new TypeError('需要原Session/request UUID');
    const snapshot = structuredClone(input);
    if (snapshot.control && (snapshot.control.kind === 'stop' ?
      snapshot.message.method !== 'turn/interrupt' || snapshot.message.params?.turnId !== snapshot.control.turnId || snapshot.message.params?.threadId !== snapshot.conversationId :
      snapshot.message.method != null || rpcControlRequestKey(snapshot.message.id, snapshot.epoch) !== snapshot.control.requestId || !snapshot.epoch ||
      (snapshot.message.params?.turnId !== undefined && snapshot.message.params.turnId !== snapshot.control.turnId))) throw new TypeError('控制必须绑定原RPC、turn/request及epoch');
    const initialization = this.#initializations.get(key([snapshot.context, snapshot.sessionId]));
    if ((snapshot.settings as any)?.source === 'public-rpc-v1' && snapshot.sessionId !== HOSTED_SESSION_ID && !initialization) throw new QueueError(409, '原 Session 尚未完成 initialize，操作未受理');
    const envelope: RpcBody = { kind: 'rpc-v1', sessionId: snapshot.sessionId, requestId: snapshot.requestId, message: snapshot.message, ...(snapshot.epoch ? { epoch: snapshot.epoch } : {}), ...(initialization ? { initialization: structuredClone(initialization) } : {}) };
    const parents = captureRemoteOperation(); let delivery = () => {};
    const receipt = await this.budget(async call => {
      const value = await this.ledger([snapshot.context], ['submit'], call, () => this.#queue.submit({ id: snapshot.id, context: snapshot.context,
        conversationId: snapshot.conversationId, body: envelope, settings: snapshot.settings, attachmentRefs: snapshot.attachmentRefs,
        ...(snapshot.control ? { control: snapshot.control } : {}), rpcReceipt: { sessionId: snapshot.sessionId, requestId: snapshot.requestId, ...(snapshot.message.method ? { method: snapshot.message.method } : {}),
          signature: createHash('sha256').update(rpcSignatureInput(snapshot.message, snapshot.epoch)).digest('hex'), submissionSignature: createHash('sha256').update(rpcSignatureInput(snapshot.message, snapshot.epoch)).digest('hex') } }));
      const fence = await this.#options.resolver.authorizeOperation(snapshot.context, 'submit', call.signal);
      delivery = () => { fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('提交原预算已结束'); };
      delivery(); return value;
    }, call);
    delivery(); assertRemoteOperation(); this.#wakeup?.(); return receipt;
  }

  private async protocolRpc(input: { context: OperationContext; sessionId: string; requestId: string; message: RpcMessage }, original?: SessionCallOptions) {
    const snapshot = structuredClone(input); const parents = captureRemoteOperation(); let delivery = () => {};
    if (snapshot.sessionId === SIDECHAT || !UUID.test(snapshot.sessionId) || !['initialize', 'initialized'].includes(snapshot.message.method ?? '')) throw new TypeError('仅允许原Session初始化协议');
    const result = await this.budget(async call => {
      if (snapshot.context.mode === 'remote') {
        const fence = await this.#options.resolver.authorizeOperation(snapshot.context, 'submit', call.signal);
        const target = await this.#options.resolver.resolve({ mode: 'remote', gatewayId: snapshot.context.gatewayId,
          account: { accountId: snapshot.context.managed.accountId, accountUserId: snapshot.context.managed.accountUserId,
            ...(Object.hasOwn(snapshot.context.managed, 'userId') ? { userId: snapshot.context.managed.userId } : {}) }, target: snapshot.context.target }, call.signal);
        fence();
        if (!target.descriptor.online) {
          const binding = key([snapshot.context, snapshot.sessionId]);
          if (snapshot.message.method === 'initialize') this.#initializations.set(binding, { message: snapshot.message });
          else { const previous = this.#initializations.get(binding); if (!previous) throw new Error('原Session未完成initialize'); previous.notification = snapshot.message; }
          // 此 ACK 仅确认手机已接入网关；明确标注上游离线，不建立或伪造上游 Session。
          const message = { ...(snapshot.message.id != null ? { id: snapshot.message.id } : {}), result: { gateway: { upstreamReady: false, acceptingOffline: true } } };
          delivery = () => { fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('协议预算结束'); };
          delivery(); return { outcome: 'response' as const, message };
        }
      }
      const sessions = await this.sessions(snapshot.context, call);
      const result = await sessions.dispatchRpc({ sessionId: snapshot.sessionId, requestId: snapshot.requestId, attemptId: randomUUID() }, snapshot.message, call);
      if (result.outcome === 'response' && result.message.error == null) {
        const binding = key([snapshot.context, snapshot.sessionId]);
        if (snapshot.message.method === 'initialize') this.#initializations.set(binding, { message: snapshot.message });
        else { const previous = this.#initializations.get(binding); if (!previous) throw new Error('原Session未完成initialize'); previous.notification = snapshot.message; }
      }
      const fence = await this.#options.resolver.authorizeOperation(snapshot.context, 'read', call.signal);
      delivery = () => { fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('协议原预算已结束'); };
      delivery(); return result;
    }, original);
    delivery(); assertRemoteOperation(); return result;
  }
  private async sessionEvents(context: OperationContext, sessionId: string, after: number, original?: SessionCallOptions) {
    context = structuredClone(context); const parents = captureRemoteOperation(); let delivery = () => {};
    if (sessionId === SIDECHAT || !UUID.test(sessionId) || !Number.isSafeInteger(after) || after < 0) throw new TypeError('需要原Session与合法事件游标');
    const result = await this.budget(async call => {
      const sessions = await this.sessions(context, call); const result = await sessions.readEvents(sessionId, after, call);
      this.#options.onEvents?.(context, sessionId, result);
      const fence = await this.#options.resolver.authorizeOperation(context, 'read', call.signal);
      delivery = () => { fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('事件原预算已结束'); };
      delivery(); return result;
    }, original);
    delivery(); assertRemoteOperation(); return result;
  }
  start(): void {
    this.assertOpen(); if (this.#timer) return;
    const tick = () => { void this.runOnce().catch(error => { this.lastError = error; }); };
    this.#timer = setInterval(tick, this.#options.scanIntervalMs ?? 1000); this.#timer.unref(); tick();
  }
  runOnce(): Promise<void> {
    this.assertOpen(); if (this.#running) { this.#wakeup?.(); return this.#running; }
    const pending = withIndependentRemoteOperation(() => this.assertOpen(), () => this.scan());
    this.#running = pending.finally(() => { this.#running = undefined; }); return this.#running;
  }
  private async scan(): Promise<void> {
    const attempted = new Set<string>(); const seen = new Set<string>();
    // 每轮只重试开始时已有的清理事实；新失败已在catch中尝试一次，不忙重试。
    const recoveries = [...abandonedClaims.entries()].filter(([, value]) => value.directory === this.#options.directory && value.gatewayId === this.#options.gatewayId);
    const active = new Map<Promise<void>, 'control' | 'foreground' | 'background'>(); const dispatching = new Set<string>(); const authorizing = new Set<string>(); let fatal: unknown;
    try {
      for (let round = 0; round < 1024; round++) {
        this.assertOpen(); if (fatal) throw fatal; const groups = await this.#queue.inventory(); this.assertOpen();
        const inventoryRevision = key(groups);
        const pendingIds = new Set(groups.flatMap(group => group.operations.map(receipt => receipt.id)));
        for (const id of this.#readReconciliations.keys()) if (!pendingIds.has(id)) this.#readReconciliations.delete(id);
        const jobs: { binding: string; control: boolean; background?: boolean; work: () => Promise<void> }[] = [];
        for (const [binding, recovery] of recoveries) {
          const jobKey = key(['cleanup', binding]);
          if (!seen.has(jobKey) && !authorizing.has(key(recovery.claim.context)) && abandonedClaims.get(binding) === recovery) jobs.push({ binding: jobKey, control: false, work: async () => {
            const contextKey = key(recovery.claim.context); authorizing.add(contextKey);
            try { await this.cleanupClaim(recovery.claim); } finally { authorizing.delete(contextKey); }
          } });
        }
        for (const group of groups) {
          for (const receipt of group.operations) {
            const binding = key(['reconcile', receipt]);
            const previousRead = this.#readReconciliations.get(receipt.id);
            const sameRead = previousRead?.revision === receipt.revision;
            if (sameRead && performance.now() < previousRead.after) continue;
            if (['uncertain', 'failed'].includes(receipt.state) && !dispatching.has(receipt.id) && !seen.has(binding)) jobs.push({ binding, control: false, background: sameRead, work: () => this.reconcile(group.context, receipt).finally(() => this.wakeOperation(receipt.id)) });
          }
          if (!group.operations.some(receipt => receipt.state === 'queued' || receipt.state === 'claimed')) continue;
          for (const kind of ['control', 'foreground', 'background'] as const) {
            const control = kind === 'control'; const background = kind === 'background';
            const binding = key(['claim', group, inventoryRevision, kind]);
            if (seen.has(binding) || authorizing.has(key(group.context))) continue;
            jobs.push({ binding, control, background, work: async () => {
              authorizing.add(key(group.context));
              let record: OperationRecord | null;
              let prepared: OperationClaim | undefined;
              try { record = await this.budget(call => this.ledger([group.context], ['claim', 'transition'], call,
                () => this.#queue.claimNext(group.context.businessKey, { isRead, excluded: attempted, controlOnly: control, eligible: record => control || isBackground(record) === background, onPreparedClaim: claim => { prepared = claim; } }))); }
              catch (error) { if (prepared) { attempted.add(prepared.id); await this.cleanupClaim(prepared); } throw error; }
              finally { authorizing.delete(key(group.context)); }
              if (!record) return;
              attempted.add(record.id); dispatching.add(record.id);
              try { await this.execute(record); } finally { dispatching.delete(record.id); this.wakeOperation(record.id); }
            } });
          }
        }
        // 普通写/对账最多三项，第四个槽仅留原turn控制，不能被等待响应的写占满。
        const job = jobs.sort((a, b) => Number(b.control) - Number(a.control) || Number(!!a.background) - Number(!!b.background)).find(job =>
          job.control ? ![...active.values()].includes('control') : [...active.values()].filter(kind => kind !== 'control').length < 3 &&
            (!job.background || [...active.values()].filter(kind => kind === 'background').length < 2));
        if (job) {
          seen.add(job.binding);
          const work = job.work().catch(error => {
            if (error instanceof OperationQueueError && !['revision-conflict', 'claim-conflict', 'not-proven-never-sent'].includes(error.code)) fatal ??= error;
            this.lastError = error;
          }).finally(() => { active.delete(work); });
          active.set(work, job.control ? 'control' : job.background ? 'background' : 'foreground');
          continue;
        }
        if (!active.size) return;
        await Promise.race([...active.keys(), new Promise<void>(resolve => { this.#wakeup = resolve; })]);
        this.#wakeup = undefined;
      }
    } finally { this.#wakeup = undefined; await Promise.allSettled(active.keys()); }
  }
  private async reconcile(context: OperationContext, receipt: OperationReceipt): Promise<void> {
    await this.budget(async call => {
      const record = await this.ledger([context], ['read'], call, () => this.#queue.read(receipt.id));
      if (record.followUp && !record.rpcReceipt) {
        let original;
        try { original = await readOriginalOperation({ gatewayCodexHome: this.#options.gatewayCodexHome, resolver: this.#options.resolver, context,
          sessionId: 'c0dec000-0000-4000-8000-000000000001', requestId: record.followUp.operationId, call }); }
        catch (error: any) {
          if (error.status !== 404 || !record.followUp.legacyRecovery || context.mode !== 'local') return;
          await this.ledger([context], ['transition'], call, () => this.#queue.changeFollowUp(record.id, record.revision, 'transition', current => {
            current.state = current.followUp!.method === 'turn/steer' ? current.followUp!.restoreState ?? 'failed' : 'queued';
            delete current.followUp!.legacyRecovery; delete current.followUp!.restoreState; delete current.followUp!.method; delete current.followUp!.error;
          })); return;
        }
        if (original.status === 'completed' && original.message) {
          if (record.state === 'failed' && original.message.error != null) return;
          await this.ledger([context], ['transition'], call, () => this.#queue.changeFollowUp(record.id, record.revision, 'transition', current => {
            current.state = original.message!.error != null ? 'failed' : 'succeeded'; delete current.followUp!.legacyRecovery;
            if (original.message!.error != null) { delete current.followUp!.error; current.followUp!.walError = true; }
          }));
        } else if (record.followUp.legacyRecovery) await this.ledger([context], ['transition'], call, () => this.#queue.changeFollowUp(record.id, record.revision, 'transition', current => {
          delete current.followUp!.legacyRecovery;
        }));
        return;
      }
      const rpc = body(record); if (!rpc) return;
      // 只在按原context实际授权读取后确认只读；不改变原WAL、状态或未知写屏障。
      if (isRead(record)) {
        this.#readReconciliations.set(record.id, { revision: record.revision, after: performance.now() + 30_000 });
        if (this.#readReconciliations.size > 256) this.#readReconciliations.delete(this.#readReconciliations.keys().next().value!);
      }
      const completedRead = isRead(record) ? this.#results.get(record.id) : undefined;
      let result = completedRead?.outcome === 'response' ? { status: 'completed' as const, message: completedRead.message } : await readOriginalOperation({ gatewayCodexHome: this.#options.gatewayCodexHome, resolver: this.#options.resolver, context,
        sessionId: rpc.sessionId, requestId: rpc.requestId, expected: { message: rpc.message, epoch: rpc.epoch }, expectedSignature: record.rpcReceipt?.signature, call });
      if (result.status !== 'completed' && rpc.message.method === 'mobile/attachments/upload' && this.#options.attachments) {
        const sessions = await this.sessions(context, call);
        const message = await sessions.reconcileAttachment(rpc.requestId, rpc.message, call);
        if (message) result = { ...result, status: 'completed', message };
      }
      if (result.status !== 'completed' || !result.message || (record.state === 'failed' && result.message.error != null)) return;
      this.snapshots.put(record.context, rpc.message, result.message);
      if (result.message.error == null && (record.settings as any)?.source === 'public-rpc-v1') await this.#options.onResponse?.(record.context, rpc.message, result.message, rpc.sessionId);
      await this.ledger([context], ['transition'], call, () => this.#queue.settle(record.id, record.revision, record.claimToken!, result.message!.error != null ? 'failed' : 'succeeded', rpc.message.method === 'thread/start' && result.message!.error == null ? (result.message!.result as any)?.thread?.id : undefined));
    });
  }
  private async sessions(context: OperationContext, call: SessionCallOptions): Promise<HttpSessions> {
    const resolver = this.#options.resolver;
    const target = context.mode === 'remote' ? await resolver.resolve({ mode: 'remote', gatewayId: context.gatewayId, account: {
      accountId: context.managed.accountId, accountUserId: context.managed.accountUserId, ...(Object.hasOwn(context.managed, 'userId') ? { userId: context.managed.userId } : {}),
    }, target: context.target }, call.signal) : await resolver.resolve(undefined, call.signal);
    const fence = await resolver.authorizeOperationExecution(context, call.signal); fence.assertCurrent(); this.assertOpen();
    const binding = key([context, target.descriptor.authorizationKey]);
    let sessions = this.#sessions.get(binding);
    if (sessions && !sessions.consumersAvailable) {
      await sessions.close(); if (this.#sessions.get(binding) === sessions) this.#sessions.delete(binding); sessions = undefined;
      fence.assertCurrent(); this.assertOpen();
    }
    if (!sessions) {
      let opening = this.#sessionOpenings.get(binding);
      if (!opening) {
        opening = (async () => {
          let remote: HttpSessionRemoteOptions | undefined;
          let consumers: RemoteSessionConsumers | undefined;
          if (context.mode === 'remote') {
            consumers = await this.#options.remoteConsumers(structuredClone(context), target as ResolvedRemoteTarget, call);
            fence.assertCurrent(); this.assertOpen();
            if (!consumers) throw new TypeError('Remote需要显式consumer，不能回落Local');
            remote = { ...consumers, target: target as ResolvedRemoteTarget, resolver, context,
              storageNamespace: createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', context.authorizationKey])).digest('hex') };
          }
          fence.assertCurrent(); this.assertOpen();
          const value = !remote && this.#options.localSessions ? this.#options.localSessions :
            new HttpSessions({ codexHome: this.#options.gatewayCodexHome, upstreamUrl: this.#options.upstreamUrl,
              ...(remote ? { remote, notifications: consumers?.notifications, uploadMeter: consumers?.uploadMeter, attachments: this.#options.attachments, titleSummary: consumers?.titleSummary } : {}) });
          try { this.#options.onSessions?.(structuredClone(context), value); }
          catch (error) { await value.close(); throw error; }
          this.#sessions.set(binding, value); return value;
        })();
        this.#sessionOpenings.set(binding, opening);
        void opening.finally(() => { if (this.#sessionOpenings.get(binding) === opening) this.#sessionOpenings.delete(binding); }).catch(() => {});
      }
      sessions = await opening;
    }
    fence.assertCurrent(); this.assertOpen(); return sessions;
  }
  private async execute(record: OperationRecord): Promise<void> {
    const claimToken = record.claimToken!;
    this.#dispatchClaims.set(record.id, claimToken);
    let potential = false;
    let preparedClaim: OperationClaim | undefined;
    try {
      await this.budget(async call => {
        const sessions = await this.sessions(record.context, call); this.assertOpen();
        if (!record.followUp && !record.control && (record.settings as any)?.source === 'public-rpc-v1' && body(record)?.message.method === 'turn/start') {
          // 手机直发与托管追问遵守同一个真实 idle 门槛，离线受理不跳过正在运行的回合。
          const status = await this.inspectFollowUp(record, call);
          if (status.active) {
            await this.ledger([record.context], ['transition'], call, () => this.#queue.releaseClaim(record.id, record.revision, record.claimToken!));
            return;
          }
        }
        if (record.followUp) {
          const steer = record.followUp.method === 'turn/steer'; const status = await this.inspectFollowUp(record, call, steer);
          if (steer && (!status.active || status.turnId !== record.followUp.expectedTurnId)) {
            await this.ledger([record.context], ['transition'], call, () => this.#queue.changeFollowUp(record.id, record.revision, 'transition', current => {
              current.state = 'failed'; current.followUp!.error = FOLLOW_UP_TURN_EXPIRED_ERROR;
            })); return;
          }
          if (!steer && status.active) { await this.ledger([record.context], ['transition'], call, () => this.#queue.releaseClaim(record.id, record.revision, record.claimToken!)); return; }
          const follow = { ...record.followUp, method: steer ? 'turn/steer' as const : 'turn/start' as const };
          const message = followUpMessage({ ...record, followUp: follow })!;
          const rpcReceipt = { sessionId: 'c0dec000-0000-4000-8000-000000000001', requestId: follow.operationId, signature: createHash('sha256').update(rpcSignatureInput(message)).digest('hex') };
          const prepared = await this.ledger([record.context], ['transition'], call, () => this.#queue.changeFollowUp(record.id, record.revision, 'transition', current => {
            current.followUp = follow; current.rpcReceipt = rpcReceipt;
            // 仅记录可能提交的新版本；最终交付失败时，仍须原授权与精确CAS证明可释放。
            preparedClaim = { id: current.id, revision: current.revision + 1, context: structuredClone(current.context), claimToken: current.claimToken! };
          }));
          record = { ...record, ...prepared, followUp: follow, rpcReceipt };
        }
        const rpc = body(record); if (!rpc) throw new Error('旧或未知正文保留写屏障，不能派发');
        if (rpc.sessionId !== 'c0dec000-0000-4000-8000-000000000001') {
          if (!rpc.initialization) throw new Error('普通Session缺少原初始化快照，保留原项');
          await sessions.initializeQueuedSession(rpc.sessionId, rpc.initialization, call); this.assertOpen();
        }
        const marked = await this.ledger([record.context], ['transition'], call, () => this.#queue.markPotentialSend(record.id, record.revision, record.claimToken!));
        potential = marked.state === 'uncertain'; if (!potential) return;
        const attempt: SessionDispatchAttempt = { sessionId: rpc.sessionId, requestId: rpc.requestId, attemptId: record.claimToken! };
        const expiresAt = record.control?.expiresAt;
        const dispatchCall = expiresAt === undefined ? call : { ...call, deadline: Math.min(call.deadline, performance.now() + Math.max(0, expiresAt - Date.now())) };
        const dispatch = () => sessions.dispatchRpc(attempt, rpc.message, dispatchCall, rpc.epoch);
        // 原控制期限沿Session/WAL等待传至Local与Relay物理send；结算仍使用本次独立预算。
        const result = expiresAt === undefined ? await dispatch() : await withRemoteOperation(() => {
          if (Date.now() >= expiresAt) throw new Error('原控制已过期，禁止迟发');
        }, dispatch); this.assertOpen();
        if (result.outcome === 'neverSent') {
          let recheck = () => false;
          const valid = await sessions.provesNeverSent(result, attempt, check => { recheck = check; });
          if (valid) await this.ledger([record.context], ['transition'], call, () => this.#queue.confirmNeverSent(record.id, marked.revision, record.claimToken!, original =>
            original.claimToken === attempt.attemptId && body(original)?.sessionId === attempt.sessionId && body(original)?.requestId === attempt.requestId && recheck()));
        } else if (result.outcome === 'response') {
          // 原只读结果先进入本实例缓存，再发布 compact 终态，避免查询落在两者之间。
          if (isRead(record)) {
            this.#results.set(record.id, result);
            if (this.#results.size > 128) this.#results.delete(this.#results.keys().next().value!);
          }
          this.snapshots.put(record.context, rpc.message, result.message);
          if (result.message.error == null && (record.settings as any)?.source === 'public-rpc-v1') await this.#options.onResponse?.(record.context, rpc.message, result.message, rpc.sessionId);
          await this.ledger([record.context], ['transition'], call, () => this.#queue.settle(record.id, marked.revision, record.claimToken!, result.message.error != null ? 'failed' : 'succeeded', rpc.message.method === 'thread/start' && result.message.error == null ? (result.message.result as any)?.thread?.id : undefined));
        }
        if (result.outcome !== 'response') this.#diagnostics.set(record.id, result.error);
      }, undefined, body(record)?.message.method === 'mobile/titleSummary' ? 130_000 : this.#options.attemptTimeoutMs ?? 60_000);
    } catch (error) {
      if (!potential) {
        if (preparedClaim) await this.cleanupClaim(preparedClaim);
        // 准备可能尚未耐久；旧版本同样只尝试原token/revision，绝不跨uncertain边界。
        if (!preparedClaim || preparedClaim.revision !== record.revision) await this.cleanupClaim({ id: record.id, revision: record.revision, context: record.context, claimToken: record.claimToken! });
      }
      throw error;
    } finally {
      if (this.#dispatchClaims.get(record.id) === claimToken) this.#dispatchClaims.delete(record.id);
    }
  }
  private cleanupClaim(claim: OperationClaim): Promise<void> {
    const binding = key([this.#options.directory, this.#options.gatewayId, claim.context, claim.id, claim.revision, claim.claimToken]);
    let recovery = abandonedClaims.get(binding);
    if (!recovery) { recovery = { directory: this.#options.directory, gatewayId: this.#options.gatewayId, claim: structuredClone(claim) }; abandonedClaims.set(binding, recovery); }
    if (recovery.pending) return recovery.pending;
    const pending = this.releaseClaim(recovery.claim).then(() => { abandonedClaims.delete(binding); }, error => {
      // 原claim已经改变（含uncertain/终态）只丢弃旧清理事实，绝不重排未知项。
      if (error instanceof OperationQueueError && ['revision-conflict', 'claim-conflict', 'invalid-transition'].includes(error.code)) abandonedClaims.delete(binding);
      else { this.#diagnostics.set(claim.id, error); this.lastError = error; }
    }).finally(() => { if (recovery.pending === pending) recovery.pending = undefined; });
    recovery.pending = pending; return pending;
  }
  private async releaseClaim(record: OperationClaim): Promise<void> {
    const controller = new AbortController(); const deadline = performance.now() + (this.#options.attemptTimeoutMs ?? 60_000);
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now())); timer.unref();
    const check = () => { if (controller.signal.aborted || performance.now() >= deadline) throw new Error('未发送claim清理预算已结束'); };
    try {
      await withIndependentRemoteOperation(check, async () => {
        const fence = await this.#options.resolver.authorizeOperation(record.context, 'transition', controller.signal);
        const authorize = () => { check(); fence(); };
        await this.#authorization.run(new Map([[key([record.context, 'transition']), authorize]]), () => this.#queue.releaseClaim(record.id, record.revision, record.claimToken!));
      });
    } finally { clearTimeout(timer); }
  }
  private async readResult(id: string, original?: SessionCallOptions, authorizedRecord?: OperationRecord): Promise<SessionDispatchResult> {
    let finalFence: OperationAuthorizationFence | undefined; let finalCheck = () => {}; const parents = captureRemoteOperation();
    const result = await this.budget(async call => {
      const context = authorizedRecord?.context ?? await this.#queue.locate(id);
      const record = authorizedRecord ?? await this.ledger([context], ['read'], call, () => this.#queue.read(id));
      const rpc = record.rpcReceipt ?? body(record); if (!rpc) throw new Error('旧记录缺少原RPC收据定位');
      let result: SessionDispatchResult;
      const actual = this.#results.get(id);
      if (actual) result = actual;
      else {
        const stored = await readOriginalOperation({ gatewayCodexHome: this.#options.gatewayCodexHome, resolver: this.#options.resolver, context: record.context, sessionId: rpc.sessionId, requestId: rpc.requestId, ...(body(record) ? { expected: { message: body(record)!.message, epoch: body(record)!.epoch } } : {}), expectedSignature: record.rpcReceipt?.signature, call });
        result = stored.status === 'completed' && stored.message ? { outcome: 'response', message: stored.message } : { outcome: 'unknown', error: new Error('请求结果待确认') };
      }
      finalFence = await this.#options.resolver.authorizeOperation(context, 'read', call.signal);
      finalCheck = () => { finalFence!(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('结果预算已结束'); };
      finalCheck(); assertRemoteOperation(); return structuredClone(result);
    }, original);
    finalCheck(); assertRemoteOperation(); return result;
  }
  private async cancelQueuedNavigation(id: string, revision: number, context: OperationContext): Promise<OperationReceipt> {
    context = structuredClone(context); const parents = captureRemoteOperation(); let delivery = () => {};
    const result = await this.budget(async call => {
      const record = await this.ledger([context], ['read'], call, () => this.#queue.read(id));
      const rpc = body(record); if (key(record.context) !== key(context) || !rpc || !isReadOnlyRpc(rpc.message) || !isNavigationResume(rpc.message)) throw new Error('只能取消指定原导航请求');
      const value = await this.ledger([context], ['cancel'], call, () => this.#queue.cancel(id, revision));
      const fence = await this.#options.resolver.authorizeOperation(context, 'cancel', call.signal);
      delivery = () => { fence(); parents(); this.assertOpen(); if (call.signal?.aborted || performance.now() >= call.deadline) throw new Error('取消原预算已结束'); };
      delivery(); return value;
    });
    delivery(); assertRemoteOperation(); return result;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    let resolve!: () => void; let reject!: (error: unknown) => void;
    const closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.#closing = closing; // 先固定Promise，abort监听同步重入仍取同一次真实收尾。
    this.#closed = true; this.#wakeup?.(); if (this.#timer) clearInterval(this.#timer);
    for (const controller of this.#controllers) controller.abort(new Error('RPC调度器已关闭'));
    void (async () => {
      await Promise.allSettled([...this.#sessions.values()].map(value => value.close()));
      await Promise.allSettled([...this.#calls, ...(this.#running ? [this.#running] : [])]);
      await Promise.allSettled([...this.#sessionOpenings.values()]);
      await Promise.all([...this.#sessions.values()].map(value => value.close()));
    })().then(resolve, reject);
    return closing;
  }
  async settled(): Promise<void> { if (this.#closing) await this.#closing; else await this.#running; }
}
