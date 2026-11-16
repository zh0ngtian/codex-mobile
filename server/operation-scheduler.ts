import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { OperationQueue, OperationQueueError, type OperationAuthorizationFence, type OperationContext, type OperationControl, type OperationReceipt, type OperationRecord } from './operation-queue.js';
import { HttpSessions, isReadOnlyRpc, readOriginalOperation, type HttpSessionRemoteOptions, type RpcMessage, type SessionCallOptions, type SessionDispatchAttempt, type SessionDispatchResult } from './http-session.js';
import { isNavigationResume, rpcSignatureInput, rpcControlRequestKey } from './rpc-replay.js';
import { TargetResolver } from './targets.js';
import { assertRemoteOperation, captureRemoteOperation, withIndependentRemoteOperation, withRemoteOperation } from './remote/operation-guard.js';

type Action = Parameters<TargetResolver['authorizeOperation']>[1];
interface RpcInitialization { message: RpcMessage; notification?: RpcMessage }
interface RpcBody { kind: 'rpc-v1'; sessionId: string; requestId: string; message: RpcMessage; epoch?: string; initialization?: RpcInitialization }
export interface QueuedRpcInput {
  id: string; context: OperationContext; conversationId: string; sessionId: string; requestId: string;
  message: RpcMessage; settings: unknown; attachmentRefs: string[]; epoch?: string; control?: OperationControl;
}
interface Options {
  directory: string; gatewayId: string; gatewayCodexHome: string; resolver: TargetResolver; upstreamUrl: string;
  remoteConsumers: (context: Readonly<OperationContext>) => Pick<HttpSessionRemoteOptions, 'projections' | 'sidechatReplay'>;
  attemptTimeoutMs?: number; scanIntervalMs?: number;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SIDECHAT = 'c0dec000-0000-4000-8000-000000000002';
function key(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(key).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${key(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function body(record: Readonly<OperationRecord>): RpcBody | undefined {
  if (!record.rpcReceipt) return; // 旧合法未知body保留写屏障，不猜成可信RPC。
  const value = record.body as RpcBody | undefined;
  if (!value || value.kind !== 'rpc-v1' || !UUID.test(value.sessionId) || value.sessionId === SIDECHAT || !UUID.test(value.requestId) || !value.message || typeof value.message !== 'object' || Array.isArray(value.message)) return;
  return value;
}
function isRead(record: Readonly<OperationRecord>): boolean { const rpc = body(record); return !!rpc && !record.control && isReadOnlyRpc(rpc.message); }

/** 仅内部唯一RPC owner；公开路由和旧FollowUps尚未启用本调度器。 */
export class OperationScheduler {
  readonly #options: Options;
  readonly #queue: OperationQueue;
  readonly #authorization = new AsyncLocalStorage<Map<string, OperationAuthorizationFence | unknown>>();
  readonly #controllers = new Set<AbortController>();
  readonly #calls = new Set<Promise<unknown>>();
  readonly #sessions = new Map<string, HttpSessions>();
  readonly #initializations = new Map<string, RpcInitialization>();
  readonly #results = new Map<string, SessionDispatchResult>();
  readonly #diagnostics = new Map<string, unknown>();
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
    this.#options = { ...options };
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
  cancelNavigation(id: string, revision: number, context: OperationContext): Promise<OperationReceipt> { return this.own(() => this.cancelQueuedNavigation(id, revision, context)); }
  private async budget<T>(operation: (call: SessionCallOptions) => Promise<T>, original?: SessionCallOptions): Promise<T> {
    original = original ? { deadline: original.deadline, signal: original.signal } : undefined;
    if (original && !Number.isFinite(original.deadline)) throw new TypeError('需要有限的原调用deadline');
    const controller = new AbortController(); this.#controllers.add(controller);
    const deadline = Math.min(original?.deadline ?? Infinity, performance.now() + (this.#options.attemptTimeoutMs ?? 60_000));
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
    const envelope: RpcBody = { kind: 'rpc-v1', sessionId: snapshot.sessionId, requestId: snapshot.requestId, message: snapshot.message, ...(snapshot.epoch ? { epoch: snapshot.epoch } : {}), ...(initialization ? { initialization: structuredClone(initialization) } : {}) };
    const parents = captureRemoteOperation(); let delivery = () => {};
    const receipt = await this.budget(async call => {
      const value = await this.ledger([snapshot.context], ['submit'], call, () => this.#queue.submit({ id: snapshot.id, context: snapshot.context,
        conversationId: snapshot.conversationId, body: envelope, settings: snapshot.settings, attachmentRefs: snapshot.attachmentRefs,
        ...(snapshot.control ? { control: snapshot.control } : {}), rpcReceipt: { sessionId: snapshot.sessionId, requestId: snapshot.requestId, signature: createHash('sha256').update(rpcSignatureInput(snapshot.message, snapshot.epoch)).digest('hex') } }));
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
    const active = new Map<Promise<void>, boolean>(); const dispatching = new Set<string>(); const authorizing = new Set<string>(); let fatal: unknown;
    try {
      for (let round = 0; round < 1024; round++) {
        this.assertOpen(); if (fatal) throw fatal; const groups = await this.#queue.inventory(); this.assertOpen();
        const inventoryRevision = key(groups);
        const jobs: { binding: string; control: boolean; work: () => Promise<void> }[] = [];
        for (const group of groups) {
          for (const receipt of group.operations) {
            const binding = key(['reconcile', receipt]);
            if (['uncertain', 'failed'].includes(receipt.state) && !dispatching.has(receipt.id) && !seen.has(binding)) jobs.push({ binding, control: false, work: () => this.reconcile(group.context, receipt) });
          }
          if (!group.operations.some(receipt => receipt.state === 'queued' || receipt.state === 'claimed')) continue;
          for (const control of [true, false]) {
            const binding = key(['claim', group, inventoryRevision, control]);
            if (seen.has(binding) || authorizing.has(key(group.context))) continue;
            jobs.push({ binding, control, work: async () => {
              authorizing.add(key(group.context));
              let record: OperationRecord | null;
              try { record = await this.budget(call => this.ledger([group.context], ['claim', 'transition'], call,
                () => this.#queue.claimNext(group.context.businessKey, { isRead, excluded: attempted, controlOnly: control }))); }
              finally { authorizing.delete(key(group.context)); }
              if (!record) return;
              attempted.add(record.id); dispatching.add(record.id);
              try { await this.execute(record); } finally { dispatching.delete(record.id); }
            } });
          }
        }
        // 普通写/对账最多三项，第四个槽仅留原turn控制，不能被等待响应的写占满。
        const job = jobs.sort((a, b) => Number(b.control) - Number(a.control)).find(job =>
          job.control ? ![...active.values()].some(Boolean) : [...active.values()].filter(control => !control).length < 3);
        if (job) {
          seen.add(job.binding);
          const work = job.work().catch(error => {
            if (error instanceof OperationQueueError && !['revision-conflict', 'claim-conflict', 'not-proven-never-sent'].includes(error.code)) fatal ??= error;
            this.lastError = error;
          }).finally(() => { active.delete(work); });
          active.set(work, job.control);
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
      const rpc = body(record); if (!rpc) return;
      const result = await readOriginalOperation({ gatewayCodexHome: this.#options.gatewayCodexHome, resolver: this.#options.resolver, context,
        sessionId: rpc.sessionId, requestId: rpc.requestId, expected: { message: rpc.message, epoch: rpc.epoch }, expectedSignature: record.rpcReceipt?.signature, call });
      if (result.status !== 'completed' || !result.message || (record.state === 'failed' && result.message.error != null)) return;
      await this.ledger([context], ['transition'], call, () => this.#queue.settle(record.id, record.revision, record.claimToken!, result.message!.error != null ? 'failed' : 'succeeded'));
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
    if (!sessions) {
      let remote: HttpSessionRemoteOptions | undefined;
      if (context.mode === 'remote') {
        const consumers = this.#options.remoteConsumers(context);
        if (!consumers) throw new TypeError('Remote需要显式consumer，不能回落Local');
        remote = { ...consumers, target: target as HttpSessionRemoteOptions['target'], resolver, context,
          storageNamespace: createHash('sha256').update(JSON.stringify(['transport-v1', 'remote', context.authorizationKey])).digest('hex') };
      }
      sessions = new HttpSessions({ codexHome: this.#options.gatewayCodexHome, upstreamUrl: this.#options.upstreamUrl,
        ...(remote ? { remote } : {}) });
      this.#sessions.set(binding, sessions);
    }
    fence.assertCurrent(); this.assertOpen(); return sessions;
  }
  private async execute(record: OperationRecord): Promise<void> {
    let potential = false;
    try {
      await this.budget(async call => {
        const rpc = body(record); if (!rpc) throw new Error('旧或未知正文保留写屏障，不能派发');
        const sessions = await this.sessions(record.context, call); this.assertOpen();
        if (rpc.sessionId !== 'c0dec000-0000-4000-8000-000000000001') {
          if (!rpc.initialization) throw new Error('普通Session缺少原初始化快照，保留原项');
          await sessions.initializeQueuedSession(rpc.sessionId, rpc.initialization, call); this.assertOpen();
        }
        const marked = await this.ledger([record.context], ['transition'], call, () => this.#queue.markPotentialSend(record.id, record.revision, record.claimToken!));
        potential = marked.state === 'uncertain'; if (!potential) return;
        const attempt: SessionDispatchAttempt = { sessionId: rpc.sessionId, requestId: rpc.requestId, attemptId: record.claimToken! };
        const result = await sessions.dispatchRpc(attempt, rpc.message, call, rpc.epoch); this.assertOpen();
        if (result.outcome === 'neverSent') {
          let recheck = () => false;
          const valid = await sessions.provesNeverSent(result, attempt, check => { recheck = check; });
          if (valid) await this.ledger([record.context], ['transition'], call, () => this.#queue.confirmNeverSent(record.id, marked.revision, record.claimToken!, original =>
            original.claimToken === attempt.attemptId && body(original)?.sessionId === attempt.sessionId && body(original)?.requestId === attempt.requestId && recheck()));
        } else if (result.outcome === 'response') {
          await this.ledger([record.context], ['transition'], call, () => this.#queue.settle(record.id, marked.revision, record.claimToken!, result.message.error != null ? 'failed' : 'succeeded'));
          if (isRead(record)) {
            this.#results.set(record.id, result);
            if (this.#results.size > 128) this.#results.delete(this.#results.keys().next().value!);
          }
        }
        if (result.outcome !== 'response') this.#diagnostics.set(record.id, result.error);
      });
    } catch (error) {
      if (!potential) await this.releaseClaim(record).catch(cleanup => { this.#diagnostics.set(record.id, cleanup); });
      throw error;
    }
  }
  private async releaseClaim(record: OperationRecord): Promise<void> {
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
  private async readResult(id: string, original?: SessionCallOptions): Promise<SessionDispatchResult> {
    let finalFence: OperationAuthorizationFence | undefined; let finalCheck = () => {}; const parents = captureRemoteOperation();
    const result = await this.budget(async call => {
      const context = await this.#queue.locate(id);
      const record = await this.ledger([context], ['read'], call, () => this.#queue.read(id));
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
      await Promise.all([...this.#sessions.values()].map(value => value.close()));
    })().then(resolve, reject);
    return closing;
  }
  async settled(): Promise<void> { if (this.#closing) await this.#closing; else await this.#running; }
}
