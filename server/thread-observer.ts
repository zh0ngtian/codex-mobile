import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrivateStore } from './remote/private-store.js';
import type { TargetResolver } from './targets.js';
import type { OperationContext } from './operation-queue.js';
import type { OperationScheduler } from './operation-scheduler.js';
import type { SessionCallOptions, RpcMessage } from './http-session.js';

interface Observation {
  version: 1; id: string; context: OperationContext; threadId: string; fingerprint?: string;
  lastBusinessUpdate: number; lastSuccessfulPoll?: number; released: boolean;
  releaseOperationId?: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const running = (value: any) => ['active', 'running', 'inProgress', 'in_progress'].includes(typeof value === 'string' ? value : value?.type);

/** 仅 Remote 已打开会话的后台责任；Local 沿用原关注通知与托管追问。 */
export class ThreadObserver {
  private readonly store: PrivateStore;
  private readonly records = new Map<string, Observation>();
  private readonly due = new Map<string, number>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly phones = new Map<string, { expires: number; threads: Set<string> }>();
  private readonly approvalThreads = new Set<string>();
  private readonly runningThreads = new Set<string>();
  private readonly controllers = new Set<AbortController>();
  private readonly ready: Promise<void>;
  private saving = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private closed = false;
  constructor(private readonly options: {
    directory: string; resolver: Pick<TargetResolver, 'authorizeOperation'>;
    scheduler: Pick<OperationScheduler, 'hostedRpc' | 'submit' | 'runOnce' | 'hasPending' | 'operation'>;
    followed?: (context: OperationContext, threadId: string) => boolean;
    now?: () => number;
    onChanged?: (context: OperationContext, threadId: string, call: SessionCallOptions) => Promise<void>;
  }) {
    this.store = new PrivateStore(options.directory); this.ready = this.load();
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private async load() {
    const ids = await this.store.readJson('index.json');
    if (ids === null) return;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('会话观察存储损坏');
    for (const id of ids) {
      const record = await this.store.readJson(id + '.json') as Observation | null;
      if (!record || record.version !== 1 || record.id !== id || typeof record.threadId !== 'string' || !record.threadId ||
        !Number.isFinite(record.lastBusinessUpdate) || typeof record.released !== 'boolean' || hash([record.context, record.threadId]) !== id ||
        (record.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(record.fingerprint)) ||
        (record.releaseOperationId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.releaseOperationId))) throw new Error('会话观察存储损坏');
      // 旧 Local 观察文件保留原位，升级后不再轮询或重交其释放操作。
      if (record.context.mode !== 'remote') continue;
      this.records.set(id, record); this.due.set(id, 0);
    }
  }
  private save(record: Observation, fence: () => void) {
    const snapshot = structuredClone(record);
    const work = this.saving.catch(() => {}).then(async () => {
      if (this.closed) return; fence(); await this.store.writeJson(record.id + '.json', snapshot); fence();
      await this.store.writeJson('index.json', [...this.records.keys()]); fence();
    });
    this.saving = work; return work;
  }
  async opened(context: OperationContext, threadId: string, phone?: string) {
    if (context.mode !== 'remote' || !threadId || threadId.length > 1024 || this.closed) return;
    await this.ready;
    const fence = await this.options.resolver.authorizeOperation(context, 'read'); fence();
    const id = hash([context, threadId]);
    let record = this.records.get(id);
    if (!record) { record = { version: 1, id, context: structuredClone(context), threadId, lastBusinessUpdate: this.now(), released: false }; this.records.set(id, record); }
    record.released = false; this.due.set(id, 0);
    if (phone) { const key = hash([context, phone]); const old = this.phones.get(key); this.phones.set(key, { expires: this.now() + 60000, threads: new Set([...(old?.threads ?? []), id]) }); }
    await this.save(record, fence);
  }
  touch(context: OperationContext, phone: string) {
    if (context.mode !== 'remote') return;
    const item = this.phones.get(hash([context, phone])); if (item) item.expires = this.now() + 60000;
  }
  event(context: OperationContext, message: RpcMessage) {
    if (context.mode !== 'remote') return;
    const threadId = message.params?.threadId; if (typeof threadId !== 'string') return;
    const id = hash([context, threadId]); if (!this.records.has(id)) return;
    if (message.id != null && message.method) this.approvalThreads.add(id);
    if (message.method === 'serverRequest/resolved') this.approvalThreads.delete(id);
    if (message.method === 'turn/started') this.runningThreads.add(id);
    if (message.method === 'turn/completed') this.runningThreads.delete(id);
    // 事件促成立即对账；心跳、读取时间和轮询次数不推进业务时钟。
    this.due.set(id, 0);
  }
  start() {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => { void this.poll().catch(() => {}); }, 1000); this.timer.unref();
    void this.poll().catch(() => {});
  }
  async poll() {
    await this.ready; if (this.closed) return;
    for (const [key, value] of this.phones) if (value.expires <= this.now()) this.phones.delete(key);
    for (const record of this.records.values()) {
      if (this.active.size >= 4) break;
      if (record.released || this.active.has(record.id) || (this.due.get(record.id) ?? 0) > this.now()) continue;
      const work = this.inspect(record).catch(() => { this.due.set(record.id, this.now() + 3000); }).finally(() => { this.active.delete(record.id); });
      this.active.set(record.id, work);
    }
    await Promise.allSettled(this.active.values());
  }
  private async inspect(record: Observation) {
    const controller = new AbortController(); this.controllers.add(controller);
    const call = { deadline: performance.now() + 60000, signal: controller.signal };
    try {
      const fence = await this.options.resolver.authorizeOperation(record.context, 'read', call.signal); fence();
      if (record.releaseOperationId) {
        await this.submitRelease(record, call); fence();
        const state = await this.options.scheduler.operation(record.releaseOperationId, record.context, 'c0dec000-0000-4000-8000-000000000001', call); fence();
        if (state.status !== 'completed' || state.message?.error != null) throw new Error('逻辑订阅释放待确认');
        delete record.releaseOperationId;
        const responsible = [...this.phones.values()].some(item => item.threads.has(record.id)) || this.approvalThreads.has(record.id) ||
          this.runningThreads.has(record.id) || this.options.followed?.(record.context, record.threadId) === true ||
          await this.options.scheduler.hasPending(record.context, record.threadId, call);
        fence();
        if (!responsible) { record.released = true; await this.save(record, fence); return; }
        await this.save(record, fence);
      }
      const read = (method: string, params: Record<string, unknown>) => this.options.scheduler.hostedRpc(record.context, { id: randomUUID(), method, params }, call);
      // 一个耐久观察项承载有界快照读取；同 hosted epoch 仅恢复订阅一次。
      const response = await read('mobile/thread/observe', { threadId: record.threadId }); fence();
      const thread = (response.result as any)?.thread;
      if (response.error != null || !thread || thread.id !== record.threadId) throw new Error('无法读取观察会话');
      const turns = (response.result as any)?.data;
      if (!Array.isArray(turns)) throw new Error('无法读取观察回合');
      const fingerprint = hash({ thread: { id: thread.id, name: thread.name, preview: thread.preview, cwd: thread.cwd, archived: thread.archived, status: thread.status }, turns });
      if (record.fingerprint !== fingerprint) {
        await this.options.onChanged?.(record.context, record.threadId, call); fence();
        record.fingerprint = fingerprint; record.lastBusinessUpdate = this.now();
      }
      record.lastSuccessfulPoll = this.now();
      const active = running(thread.status) || turns.some(turn => running(turn.status));
      if (active) this.runningThreads.add(record.id); else this.runningThreads.delete(record.id);
      const phone = [...this.phones.values()].some(item => item.threads.has(record.id));
      const followed = this.options.followed?.(record.context, record.threadId) === true;
      const pending = await this.options.scheduler.hasPending(record.context, record.threadId, call); fence();
      const retained = phone || active || this.approvalThreads.has(record.id) || followed || pending;
      if (!retained && this.now() - record.lastBusinessUpdate >= 86400000) {
        // 最新成功读取确认无变化后才撤销责任；未知/离线读取不能触发清理。
        const id = record.releaseOperationId ?? randomUUID(); record.releaseOperationId = id;
        await this.save(record, fence);
        await this.submitRelease(record, call); fence();
        const state = await this.options.scheduler.operation(id, record.context, 'c0dec000-0000-4000-8000-000000000001', call); fence();
        // 受理不等于已释放；只认原 UUID 的确定成功，重启也不制造第二次取消订阅。
        if (state.status === 'completed' && state.message?.error == null) { record.released = true; delete record.releaseOperationId; }
        else throw new Error('逻辑订阅释放待确认');
      }
      this.due.set(record.id, this.now() + (retained ? 3000 : 60000));
      await this.save(record, fence);
    } finally { this.controllers.delete(controller); }
  }
  private async submitRelease(record: Observation, call: { deadline: number; signal: AbortSignal }) {
    const id = record.releaseOperationId!;
    // 重交同一 UUID 只做 ledger 幂等受理；崩溃落在 intent 与受理之间也不会生成第二个上游操作。
    await this.options.scheduler.submit({ id, context: record.context, conversationId: record.threadId,
      sessionId: 'c0dec000-0000-4000-8000-000000000001', requestId: id,
      message: { id, method: 'thread/unsubscribe', params: { threadId: record.threadId } },
      settings: { source: 'gateway-observer-v1' }, attachmentRefs: [] }, call);
    void this.options.scheduler.runOnce().catch(() => {});
  }
  async close() {
    this.closed = true; if (this.timer) clearInterval(this.timer);
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.active.values(), this.saving]);
  }
}
