import { constants, type Stats } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { TextDecoder, types } from 'node:util';
import { rpcSignatureInput, rpcControlRequestKey } from './rpc-replay.js';
import { PrivateStore } from './remote/private-store.js';
import { validateText, validateInputs, validateSettings, type RecordItem } from './follow-ups.js';
import { messageAttachmentCount } from './user-message-format.js';

/** 仅可信网关内部构造；businessKey只用于归组，授权始终由回调独立核验。 */
export type OperationContext = {
  mode: 'local'; gatewayId: string; businessKey: string; authorizationKey: string; localHostId: string;
} | {
  mode: 'remote'; gatewayId: string; businessKey: string; authorizationKey: string;
  managed: { accountId: string; accountUserId: string; userId?: string; codexHome: string };
  target: { environmentId: string; installationId: string }; generation: string;
};
export type OperationControl = { kind: 'stop'; turnId: string; expiresAt: number } | { kind: 'approval'; turnId: string; requestId: string; expiresAt: number };
export interface OperationRpcReceipt { sessionId: string; requestId: string; signature: string }
export interface OperationInput {
  id: string; context: OperationContext; conversationId: string;
  body: unknown; settings: unknown; attachmentRefs: string[]; memoryOnly?: false; control?: OperationControl; rpcReceipt?: OperationRpcReceipt;
}
export type OperationState = 'queued' | 'claimed' | 'uncertain' | 'failed' | 'succeeded' | 'cancelled';
/** 可信授权器捕获完整上下文及真实权限版本；同步只读断言失效即抛错，禁止异步。
 * TargetResolver/RemoteRuntime提供内部真实归属/权限检查，公开scheduler装配仍待4b.2。 */
export type OperationAuthorizationFence = () => void;
type Action = 'submit' | 'read' | 'edit' | 'cancel' | 'claim' | 'transition';
export interface OperationReceipt {
  id: string; revision: number; receiveOrder: number; state: OperationState;
}
/** 仅可信进程恢复定位；完整原context不能用businessKey合并，正文另走逐条授权read。 */
export interface OperationRecoveryGroup {
  context: OperationContext; conversationId: string; operations: OperationReceipt[];
}
export interface OperationRecord extends OperationReceipt {
  signature: string; context: OperationContext; conversationId: string;
  body?: unknown; settings?: unknown; attachmentRefs?: string[]; control?: OperationControl;
  claimToken?: string; claimPid?: number; failure?: 'control-expired'; rpcReceipt?: OperationRpcReceipt;
  followUp?: { fingerprint: string; operationId: string; text?: string; attachmentCount?: number; restoreState?: 'queued' | 'failed'; method?: 'turn/start' | 'turn/steer'; error?: string; expectedTurnId?: string; legacyRecovery?: true; walError?: true; retainedLegacy?: Pick<RecordItem, 'inputText' | 'extraInput' | 'settings'> };
}
/** 仅领取方捕获可能已耐久的未发送claim定位，不含业务正文，也不授予执行许可。 */
export interface OperationClaim { id: string; revision: number; context: OperationContext; claimToken: string }
interface Ledger { version: 1; gatewayId: string; nextOrder: number; records: OperationRecord[]; followUpsImport?: { source: string; context: OperationContext; sha256: string; count: number } }
export class OperationQueueError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(`持久操作队列：${code}`); this.name = 'OperationQueueError'; }
}
export const FOLLOW_UP_TURN_EXPIRED_ERROR = '原运行回合已失效，未发送引导';
function fail(code = 'storage', status = 503): never { throw new OperationQueueError(code, status); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function owned(stat: Stats): boolean { return !process.getuid || stat.uid === process.getuid(); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function shape(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key)) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(item => 'value' in item);
}
function contextValid(value: unknown): value is OperationContext {
  if (!object(value) || !['gatewayId', 'businessKey', 'authorizationKey'].every(key => text(value[key]))) return false;
  if (value.mode === 'local') return shape(value, ['mode', 'gatewayId', 'businessKey', 'authorizationKey', 'localHostId']) && text(value.localHostId);
  if (value.mode !== 'remote' || !shape(value, ['mode', 'gatewayId', 'businessKey', 'authorizationKey', 'managed', 'target', 'generation']) || !text(value.generation) ||
    !shape(value.managed, ['accountId', 'accountUserId', 'userId', 'codexHome']) || !shape(value.target, ['environmentId', 'installationId'])) return false;
  return ['accountId', 'accountUserId', 'codexHome'].every(key => text((value.managed as Record<string, unknown>)[key])) &&
    (!Object.hasOwn(value.managed, 'userId') || text(value.managed.userId)) && text(value.target.environmentId) && text(value.target.installationId);
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function compact(record: OperationRecord): void {
  delete record.body; delete record.settings; delete record.attachmentRefs; delete record.claimToken; delete record.claimPid;
  if (record.followUp) { delete record.followUp.text; delete record.followUp.attachmentCount; delete record.followUp.restoreState; delete record.followUp.expectedTurnId; delete record.followUp.legacyRecovery; delete record.followUp.walError; }
}
/** 追问正文和settings仅由原record生成RPC，不维护第二份可变输入。 */
export function followUpMessage(record: Readonly<OperationRecord>) {
  const follow = record.followUp; const payload = record.body as { kind?: string; inputText?: string; extraInput?: Record<string, unknown>[] } | undefined;
  if (!follow || payload?.kind !== 'follow-up-v1') return;
  return { id: follow.operationId, method: follow.method ?? 'turn/start', params: { threadId: record.conversationId,
    input: [...(payload.inputText ? [{ type: 'text', text: payload.inputText, text_elements: [] }] : []), ...(payload.extraInput ?? [])],
    ...(follow.method === 'turn/steer' ? { expectedTurnId: follow.expectedTurnId } : record.settings as Record<string, unknown>), clientUserMessageId: record.id } };
}
function terminal(record: OperationRecord): boolean { return ['succeeded', 'cancelled'].includes(record.state) || record.failure === 'control-expired'; }
function controlValid(value: unknown): value is OperationControl {
  return object(value) && shape(value, value.kind === 'stop' ? ['kind', 'turnId', 'expiresAt'] : ['kind', 'turnId', 'requestId', 'expiresAt']) && ['stop', 'approval'].includes(String(value.kind)) && text(value.turnId) && Number.isSafeInteger(value.expiresAt) && Number(value.expiresAt) > 0 && (value.kind !== 'approval' || text(value.requestId));
}
function rpcReceiptValid(value: unknown): value is OperationRpcReceipt {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return shape(value, ['sessionId', 'requestId', 'signature']) && typeof value.sessionId === 'string' && uuid.test(value.sessionId) && value.sessionId !== 'c0dec000-0000-4000-8000-000000000002' && typeof value.requestId === 'string' && uuid.test(value.requestId) && typeof value.signature === 'string' && /^[a-f0-9]{64}$/.test(value.signature);
}
function rpcBodyValid(value: unknown): value is Record<string, unknown> & { message: { method?: string }; epoch?: string } {
  if (!shape(value, ['kind', 'sessionId', 'requestId', 'message', 'epoch', 'initialization']) || value.kind !== 'rpc-v1' || !object(value.message) || (typeof value.message.method === 'string' && (value.message.method.startsWith('mobile/sidechat/') || ['initialize', 'initialized', 'rpc.ping', 'rpc.pong'].includes(value.message.method))) || (value.message.method !== undefined && typeof value.message.method !== 'string') || (value.epoch !== undefined && !text(value.epoch))) return false;
  if (value.initialization !== undefined) {
    const init = value.initialization;
    if (!shape(init, ['message', 'notification']) || !object(init.message) || init.message.method !== 'initialize' || !['string', 'number'].includes(typeof init.message.id) ||
      (init.notification !== undefined && (!object(init.notification) || init.notification.method !== 'initialized' || init.notification.id !== undefined))) return false;
  }
  return true;
}
function rpcHash(value: { message: { method?: string }; epoch?: string }): string { return createHash('sha256').update(rpcSignatureInput(value.message, value.epoch)).digest('hex'); }
function rpcControlMatches(value: unknown, control: OperationControl | undefined, conversationId: string): boolean {
  if (!control) return true;
  if (!rpcBodyValid(value)) return false;
  const message = value.message as Record<string, unknown>; const params = object(message.params) ? message.params : {};
  return control.kind === 'stop' ? message.method === 'turn/interrupt' && params.turnId === control.turnId && params.threadId === conversationId :
    message.method == null && rpcControlRequestKey(message.id, value.epoch) === control.requestId && !!value.epoch && (params.turnId === undefined || params.turnId === control.turnId);
}
function rpcBodyMatches(value: unknown, rpc: OperationRpcReceipt): boolean {
  return rpcBodyValid(value) && value.sessionId === rpc.sessionId && value.requestId === rpc.requestId && rpcHash(value) === rpc.signature;
}
function receipt(record: OperationRecord): OperationReceipt { return { id: record.id, revision: record.revision, receiveOrder: record.receiveOrder, state: record.state }; }
function followUpValid(record: OperationRecord): boolean {
  const value = record.followUp;
  if (!value || !shape(value, ['fingerprint', 'operationId', 'text', 'attachmentCount', 'restoreState', 'method', 'error', 'expectedTurnId', 'legacyRecovery', 'walError', 'retainedLegacy']) ||
    typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.operationId) || record.control || record.context.mode !== 'local' ||
    (value.method !== undefined && !['turn/start', 'turn/steer'].includes(value.method)) || (value.restoreState !== undefined && !['queued', 'failed'].includes(value.restoreState)) ||
    (value.error !== undefined && typeof value.error !== 'string') || (value.expectedTurnId !== undefined && (typeof value.expectedTurnId !== 'string' || !value.expectedTurnId.trim() || value.method !== 'turn/steer')) ||
    (value.legacyRecovery !== undefined && (value.legacyRecovery !== true || record.state !== 'uncertain' || record.rpcReceipt !== undefined)) ||
    (value.walError !== undefined && (value.walError !== true || record.state !== 'failed' || record.rpcReceipt !== undefined || value.legacyRecovery !== undefined))) return false;
  if (record.rpcReceipt && (record.rpcReceipt.sessionId !== 'c0dec000-0000-4000-8000-000000000001' || record.rpcReceipt.requestId !== value.operationId)) return false;
  if (value.method === 'turn/steer' && (record.state === 'queued' || record.rpcReceipt) && !terminal(record) && !value.expectedTurnId) return false;
  if (terminal(record)) {
    if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 32768)) return false;
    if (value.attachmentCount !== undefined && (!Number.isSafeInteger(value.attachmentCount) || value.attachmentCount < 0)) return false;
    if (value.retainedLegacy !== undefined) {
      if (!shape(value.retainedLegacy, ['inputText', 'extraInput', 'settings'])) return false;
      if (value.retainedLegacy.inputText !== undefined) validateText(value.retainedLegacy.inputText, value.text ?? '');
      if (value.retainedLegacy.extraInput !== undefined) validateInputs(value.retainedLegacy.extraInput);
      if (value.retainedLegacy.settings !== undefined) validateSettings(value.retainedLegacy.settings);
    }
  } else {
    if (value.retainedLegacy !== undefined || !shape(record.body, ['kind', 'inputText', 'extraInput']) || record.body.kind !== 'follow-up-v1' || !Array.isArray(record.attachmentRefs) || record.attachmentRefs.length) return false;
    validateText(record.body.inputText, value.text); validateInputs(record.body.extraInput); validateSettings(record.settings);
    if (!Number.isSafeInteger(value.attachmentCount) || value.attachmentCount !== messageAttachmentCount(record.body.inputText as string, record.body.extraInput)) return false;
  }
  return true;
}
// 在原预算内为全部未终态项预留完整生命周期；不落额外字段、不放大上限。
function capacityBytes(record: OperationRecord): number {
  const actual = Buffer.byteLength(JSON.stringify(record)); if (terminal(record)) return actual;
  // 本模块生成36字符UUID和安全整数PID/revision；兼容保留更长的既有合法token。
  const claimToken = record.claimToken && Buffer.byteLength(JSON.stringify(record.claimToken)) > 38 ? record.claimToken : '00000000-0000-0000-0000-000000000000';
  const future: OperationRecord = { ...record, revision: Number.MAX_SAFE_INTEGER, state: 'uncertain', claimToken, claimPid: Number.MAX_SAFE_INTEGER };
  if (record.followUp) {
    future.followUp = { ...record.followUp, method: record.followUp.method ?? 'turn/start' };
    // 只有已绑定引导才有这一确定的本地失败结算；turn本身已在该动作CAS中按原值计费。
    if (record.followUp.method === 'turn/steer' && record.followUp.expectedTurnId && record.followUp.error === undefined) future.followUp.error = FOLLOW_UP_TURN_EXPIRED_ERROR;
    future.rpcReceipt = { sessionId: 'c0dec000-0000-4000-8000-000000000001', requestId: record.followUp.operationId, signature: 'a'.repeat(64) };
  }
  let reserved = Buffer.byteLength(JSON.stringify(future));
  if (record.control) { compact(future); future.state = 'failed'; future.failure = 'control-expired'; reserved = Math.max(reserved, Buffer.byteLength(JSON.stringify(future))); }
  return Math.max(actual, reserved);
}

/** 内部ledger，尚未接入HTTP/WS或公开scheduler；不接收Sidechat正文。 */
export class OperationQueue {
  readonly #store: PrivateStore;
  readonly #gatewayId: string;
  readonly #authorize: (context: Readonly<OperationContext>, action: Action) => Promise<OperationAuthorizationFence>;
  #poisoned = false;
  constructor(options: { directory: string; gatewayId: string; authorize: (context: Readonly<OperationContext>, action: Action) => Promise<OperationAuthorizationFence> }) {
    if (typeof options.directory !== 'string' || !text(options.directory) || !text(options.gatewayId) || typeof options.authorize !== 'function') fail('invalid-input', 400);
    this.#store = new PrivateStore(options.directory); this.#gatewayId = options.gatewayId; this.#authorize = options.authorize;
  }
  private async checkDirectory(): Promise<void> {
    try { const stat = await lstat(this.#store.directory); if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat) || (stat.mode & 0o777) !== 0o700) fail(); }
    catch (error) { if (!missing(error)) throw error; }
  }
  private checkFile(stat: Stats): void {
    if (!stat.isFile() || stat.nlink !== 1 || !owned(stat) || (stat.mode & 0o777) !== 0o600 || stat.size > 68 * 1024 * 1024) fail();
  }
  private async load(): Promise<Ledger> {
    const path = join(this.#store.directory, 'operations.json');
    try {
      this.checkFile(await lstat(path));
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        this.checkFile(await handle.stat());
        const bytes = await handle.readFile(); if (bytes.length > 68 * 1024 * 1024) fail();
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!shape(value, ['version', 'gatewayId', 'nextOrder', 'records', 'followUpsImport']) || value.version !== 1 || value.gatewayId !== this.#gatewayId || !Number.isSafeInteger(value.nextOrder) || Number(value.nextOrder) < 1 || !Array.isArray(value.records)) fail();
        if (value.followUpsImport !== undefined && (!shape(value.followUpsImport, ['source', 'context', 'sha256', 'count']) || !text(value.followUpsImport.source) || !contextValid(value.followUpsImport.context) || value.followUpsImport.context.mode !== 'local' || typeof value.followUpsImport.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.followUpsImport.sha256) || !Number.isSafeInteger(value.followUpsImport.count) || Number(value.followUpsImport.count) < 0)) fail();
        const ids = new Set<string>(); const orders = new Set<number>();
        for (const record of value.records) {
          if (!shape(record, ['id', 'revision', 'receiveOrder', 'state', 'signature', 'context', 'conversationId', 'body', 'settings', 'attachmentRefs', 'control', 'claimToken', 'claimPid', 'failure', 'rpcReceipt', 'followUp']) || !text(record.id) || ids.has(record.id) || !contextValid(record.context) || record.context.gatewayId !== this.#gatewayId ||
            !text(record.conversationId) || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1 || !Number.isSafeInteger(record.receiveOrder) ||
            Number(record.receiveOrder) < 1 || Number(record.receiveOrder) >= Number(value.nextOrder) || orders.has(Number(record.receiveOrder)) ||
            !['queued', 'claimed', 'uncertain', 'failed', 'succeeded', 'cancelled'].includes(String(record.state)) || typeof record.signature !== 'string' || !/^[a-f0-9]{64}$/.test(record.signature)) fail();
          if (!terminal(record as unknown as OperationRecord) && (!Object.hasOwn(record, 'body') || !Object.hasOwn(record, 'settings') || !Array.isArray(record.attachmentRefs) || !record.attachmentRefs.every(text))) fail();
          if (terminal(record as unknown as OperationRecord) && ['body', 'settings', 'attachmentRefs'].some(key => Object.hasOwn(record, key))) fail();
          if (record.rpcReceipt !== undefined && (!rpcReceiptValid(record.rpcReceipt) || (!terminal(record as unknown as OperationRecord) && (record.followUp ? record.rpcReceipt.sessionId !== 'c0dec000-0000-4000-8000-000000000001' || record.rpcReceipt.requestId !== (record.followUp as OperationRecord['followUp'])?.operationId || record.rpcReceipt.signature !== rpcHash({ message: followUpMessage(record as unknown as OperationRecord)! }) : !rpcBodyMatches(record.body, record.rpcReceipt) || !rpcControlMatches(record.body, record.control as OperationControl | undefined, record.conversationId))))) fail();
          if (record.control !== undefined && !controlValid(record.control)) fail();
          if (record.failure !== undefined && (record.failure !== 'control-expired' || record.state !== 'failed' || !record.control)) fail();
          if (record.followUp !== undefined && !followUpValid(record as unknown as OperationRecord)) fail();
          const attempted = ['claimed', 'uncertain', 'failed'].includes(String(record.state)) && !terminal(record as unknown as OperationRecord);
          const importedAttempt = record.followUp && ['uncertain', 'failed'].includes(String(record.state)) && record.claimToken === undefined && record.claimPid === undefined;
          if (!importedAttempt && (attempted ? (!text(record.claimToken) || !Number.isSafeInteger(record.claimPid) || Number(record.claimPid) < 1) : (Object.hasOwn(record, 'claimToken') || Object.hasOwn(record, 'claimPid')))) fail();
          ids.add(record.id); orders.add(Number(record.receiveOrder));
        }
        return value as unknown as Ledger;
      } finally { await handle.close(); }
    } catch (error) { if (missing(error)) return { version: 1, gatewayId: this.#gatewayId, nextOrder: 1, records: [] }; fail(); }
  }
  private async persist(ledger: Ledger): Promise<void> {
    const path = join(this.#store.directory, 'operations.json'); const temporary = join(this.#store.directory, `.operation-${randomUUID()}`);
    let published = false;
    try {
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(ledger)); await handle.sync(); } finally { await handle.close(); }
      try { this.checkFile(await lstat(path)); } catch (error) { if (!missing(error)) throw error; }
      await rename(temporary, path); published = true;
      await this.syncDirectories();
    } catch { this.#poisoned = true; fail(); }
    finally { if (!published) await unlink(temporary).catch(() => undefined); }
  }
  private async syncDirectories(): Promise<void> {
    try {
      // 重开后的只读/重复收据也同步父项，避免未知提交只耐久文件却未耐久新目录。
      for (let current = this.#store.directory; current !== dirname(current); current = dirname(current)) {
        const directory = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch { this.#poisoned = true; fail(); }
  }
  private async transaction<T>(operation: (ledger: Ledger, authorize: (record: OperationRecord, action: Action) => Promise<void>) => Promise<{ value: T; changed?: boolean }>): Promise<T> {
    if (this.#poisoned) fail('reopen-required');
    await this.checkDirectory();
    const checked: { context: OperationContext; action: Action }[] = [];
    const value = await this.#store.withInitialization('operation-queue', async () => {
      if (this.#poisoned) fail('reopen-required'); await this.checkDirectory();
      const authorize = async (record: OperationRecord, action: Action) => {
        await this.authorized(record, action); checked.push({ context: clone(record.context), action });
      };
      const ledger = await this.load(); const result = await operation(ledger, authorize);
      if (result.changed) { this.capacity(ledger); await this.persist(ledger); }
      else await this.syncDirectories();
      return result.value;
    }).catch(error => { if (this.#poisoned && !(error instanceof OperationQueueError)) fail(); throw error; });
    // 包括事务锁释放及所有异步授权等待；后一项await不能使前一项权限过期后仍交付。
    const fences: OperationAuthorizationFence[] = [];
    for (const check of checked) fences.push(await this.#authorize(clone(check.context), check.action));
    // 此段到返回之间不可再await；栅栏必须只读，不能在校验时改变其他身份的权限。
    for (const fence of fences) this.assertAuthorized(fence);
    return value;
  }
  private capacity(ledger: Ledger): void {
    if (!Number.isSafeInteger(ledger.nextOrder) || ledger.records.some(record => !Number.isSafeInteger(record.revision))) fail('sequence-exhausted', 429);
    if (ledger.records.length > 65536) fail('receipt-capacity', 429);
    for (const control of [false, true]) {
      const records = ledger.records.filter(record => !!record.control === control);
      if (records.filter(record => !terminal(record)).length > 128 ||
        records.reduce((size, record) => size + capacityBytes(record), 0) > (control ? 2 : 64) * 1024 * 1024) fail('capacity', 429);
    }
  }
  private async authorized(record: OperationRecord, action: Action): Promise<void> {
    // 只交冻结上下文副本，不向授权器提供正文；外部对象不能充当授权凭据。
    this.assertAuthorized(await this.#authorize(clone(record.context), action));
  }
  private assertAuthorized(fence: unknown): void {
    if (typeof fence !== 'function' || types.isAsyncFunction(fence)) fail('invalid-authorization-fence');
    const result: unknown = fence();
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => undefined);
      fail('invalid-authorization-fence');
    }
  }
  private find(ledger: Ledger, id: string): OperationRecord { const record = ledger.records.find(value => value.id === id); if (!record) fail('not-found', 404); return record; }
  /** 旧Local追问唯一接管点：marker与整批记录共用原ledger事务及fsync。 */
  async importFollowUps(source: string, context: OperationContext, load: () => Promise<{ records: RecordItem[]; sha256: string }>): Promise<void> {
    if (context.mode !== 'local' || !contextValid(context) || context.gatewayId !== this.#gatewayId || !text(source)) fail('invalid-input', 400);
    await this.transaction(async (ledger, authorize) => {
      const marker = ledger.followUpsImport;
      if (marker) { if (marker.source !== source || canonical(marker.context) !== canonical(context)) fail('legacy-source-conflict', 409); return { value: undefined }; }
      const imported = await load();
      for (const item of imported.records) {
        if (ledger.records.some(record => record.id === item.id)) fail('uuid-conflict', 409);
        const { id, fingerprint, threadId, state, revision, operationId, inputText, extraInput, settings, ...fields } = item;
        const record: OperationRecord = { id, context: clone(context), conversationId: threadId, revision, receiveOrder: ledger.nextOrder++, state: ({ sending: 'uncertain', uncertain: 'uncertain', sent: 'succeeded', cancelled: 'cancelled', queued: 'queued', failed: 'failed' } as const)[state],
          signature: createHash('sha256').update(canonical([source, id, fingerprint])).digest('hex'), followUp: { fingerprint, operationId, ...fields, ...(state === 'sending' ? { legacyRecovery: true } : {}) } };
        if (!terminal(record)) { record.body = { kind: 'follow-up-v1', ...(inputText !== undefined ? { inputText } : {}), ...(extraInput !== undefined ? { extraInput } : {}) }; record.settings = settings; record.attachmentRefs = []; }
        else if (inputText !== undefined || extraInput !== undefined || settings !== undefined) record.followUp!.retainedLegacy = { ...(inputText !== undefined ? { inputText } : {}), ...(extraInput !== undefined ? { extraInput } : {}), ...(settings !== undefined ? { settings } : {}) };
        // 与重开读取复用同一目的表示校验；整批拒绝时不写记录或marker。
        if (!text(record.conversationId) || !followUpValid(record)) fail();
        await authorize(record, 'submit'); ledger.records.push(record);
      }
      ledger.followUpsImport = { source, context: clone(context), sha256: imported.sha256, count: imported.records.length };
      return { value: undefined, changed: true };
    });
  }
  async listFollowUps(context: OperationContext): Promise<OperationRecord[]> {
    return this.transaction(async (ledger, authorize) => {
      const records = ledger.records.filter(record => record.followUp && canonical(record.context) === canonical(context)).sort((a, b) => a.receiveOrder - b.receiveOrder);
      for (const record of records) await authorize(record, 'read'); return { value: clone(records) };
    });
  }
  async enqueueFollowUp(context: OperationContext, item: RecordItem): Promise<OperationReceipt> {
    if (!text(item.threadId)) fail('invalid-input', 400);
    return this.transaction(async (ledger, authorize) => {
      const existing = ledger.records.find(record => record.id === item.id);
      if (existing) {
        await authorize(existing, 'submit'); if (!existing.followUp || canonical(existing.context) !== canonical(context) || existing.followUp.fingerprint !== item.fingerprint) fail('uuid-conflict', 409);
        return { value: receipt(existing) };
      }
      const record: OperationRecord = { id: item.id, context: clone(context), conversationId: item.threadId, revision: 1, receiveOrder: ledger.nextOrder++, state: 'queued',
        signature: createHash('sha256').update(canonical([context, item.id, item.fingerprint])).digest('hex'), body: { kind: 'follow-up-v1', inputText: item.inputText, extraInput: item.extraInput }, settings: item.settings, attachmentRefs: [],
        followUp: { fingerprint: item.fingerprint, operationId: item.operationId, text: item.text, attachmentCount: item.attachmentCount } };
      await authorize(record, 'submit'); ledger.records.push(record); return { value: receipt(record), changed: true };
    });
  }
  async changeFollowUp(id: string, revision: number, action: Action, update: (record: OperationRecord) => void): Promise<OperationReceipt> {
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, action);
      if (!record.followUp) fail('uuid-conflict', 409); if (record.revision !== revision) fail('revision-conflict', 409);
      update(record); record.revision++; if (terminal(record)) compact(record);
      return { value: receipt(record), changed: true };
    });
  }
  async submit(input: OperationInput): Promise<OperationReceipt> {
    if (!input || !contextValid(input.context)) fail('invalid-input', 400);
    if (input.memoryOnly !== undefined && input.memoryOnly !== false) fail('memory-only', 400);
    if (!shape(input, ['id', 'context', 'conversationId', 'body', 'settings', 'attachmentRefs', 'memoryOnly', 'control', 'rpcReceipt'])) fail('invalid-input', 400);
    let snapshot: OperationInput;
    try { snapshot = clone(input); } catch { fail('invalid-input', 400); }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(snapshot.id) || !contextValid(snapshot.context) || snapshot.context.gatewayId !== this.#gatewayId ||
      !text(snapshot.conversationId) || !Object.hasOwn(snapshot, 'body') || !Object.hasOwn(snapshot, 'settings') || !Array.isArray(snapshot.attachmentRefs) || !snapshot.attachmentRefs.every(text) || (snapshot.control !== undefined && !controlValid(snapshot.control)) || (snapshot.rpcReceipt !== undefined && (!rpcReceiptValid(snapshot.rpcReceipt) || !rpcBodyMatches(snapshot.body, snapshot.rpcReceipt) || !rpcControlMatches(snapshot.body, snapshot.control, snapshot.conversationId)))) fail('invalid-input', 400);
    // initialize/initialized为网关取得的传输恢复快照，不能使原业务UUID随重连缓存变化。
    const signed = clone(snapshot);
    if (signed.rpcReceipt && object(signed.body)) delete signed.body.initialization;
    const signature = createHash('sha256').update(canonical(signed)).digest('hex');
    return this.transaction(async (ledger, authorize) => {
      const old = ledger.records.find(value => value.id === snapshot.id);
      if (old) { await authorize(old, 'submit'); if (old.signature !== signature) fail('uuid-conflict', 409); return { value: receipt(old) }; }
      const record: OperationRecord = { id: snapshot.id, signature, context: snapshot.context, conversationId: snapshot.conversationId, body: snapshot.body,
        settings: snapshot.settings, attachmentRefs: snapshot.attachmentRefs, revision: 1, receiveOrder: ledger.nextOrder, state: 'queued', ...(snapshot.control ? { control: snapshot.control } : {}), ...(snapshot.rpcReceipt ? { rpcReceipt: snapshot.rpcReceipt } : {}) };
      await authorize(record, 'submit'); ledger.nextOrder++; ledger.records.push(record);
      return { value: receipt(record), changed: true };
    });
  }
  async read(id: string): Promise<Readonly<OperationRecord>> {
    return this.transaction(async (ledger, authorize) => { const record = this.find(ledger, id); await authorize(record, 'read'); return { value: clone(record) }; });
  }
  /** 可信进程按UUID定位原context；与inventory一样不交付正文或传输收据。 */
  async locate(id: string): Promise<OperationContext> {
    return this.transaction(async ledger => ({ value: clone(this.find(ledger, id).context) }));
  }
  /** 内部重启发现，不执行或授权整批业务；不向公开路由交付原身份或正文。 */
  async inventory(): Promise<OperationRecoveryGroup[]> {
    return this.transaction(async ledger => {
      const groups = new Map<string, OperationRecoveryGroup>();
      for (const record of [...ledger.records].sort((a, b) => a.receiveOrder - b.receiveOrder)) {
        if (terminal(record)) continue;
        const key = canonical([record.context, record.conversationId]);
        let group = groups.get(key);
        if (!group) {
          group = { context: clone(record.context), conversationId: record.conversationId, operations: [] };
          groups.set(key, group);
        }
        group.operations.push(receipt(record));
      }
      return { value: [...groups.values()] };
    });
  }
  /** 共享可见队列；整批逐条核验，未授权记录不会返回部分正文。 */
  async list(businessKey: string, conversationId: string): Promise<OperationRecord[]> {
    return this.transaction(async (ledger, authorize) => {
      const records = ledger.records.filter(record => record.context.businessKey === businessKey && record.conversationId === conversationId && !terminal(record)).sort((a, b) => a.receiveOrder - b.receiveOrder);
      for (const record of records) await authorize(record, 'read');
      return { value: clone(records) };
    });
  }
  async edit(id: string, revision: number, patch: { body: unknown; settings?: unknown; attachmentRefs?: string[] }): Promise<OperationReceipt> {
    if (!shape(patch, ['body', 'settings', 'attachmentRefs'])) fail('invalid-input', 400);
    let snapshot: typeof patch; try { snapshot = clone(patch); } catch { fail('invalid-input', 400); }
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, 'edit');
      if (record.revision !== revision) fail('revision-conflict', 409); if (record.state !== 'queued') fail('not-editable', 409);
      if (!Object.hasOwn(snapshot, 'body') || (snapshot.attachmentRefs && !snapshot.attachmentRefs.every(text))) fail('invalid-input', 400);
      if (record.rpcReceipt) {
        const value = snapshot.body; const original = record.body as Record<string, unknown>;
        if (!rpcBodyValid(value) || value.sessionId !== record.rpcReceipt.sessionId || value.requestId !== record.rpcReceipt.requestId || value.epoch !== original.epoch || !rpcControlMatches(value, record.control, record.conversationId) || canonical(value.initialization ?? null) !== canonical(original.initialization ?? null)) fail('rpc-binding-conflict', 409);
        record.rpcReceipt.signature = rpcHash(value);
      }
      record.body = snapshot.body; if (Object.hasOwn(snapshot, 'settings')) record.settings = snapshot.settings;
      if (snapshot.attachmentRefs) record.attachmentRefs = snapshot.attachmentRefs; record.revision++;
      return { value: receipt(record), changed: true };
    });
  }
  async cancel(id: string, revision: number): Promise<OperationReceipt> {
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, 'cancel');
      if (record.revision !== revision) fail('revision-conflict', 409); if (record.state !== 'queued') fail('not-editable', 409);
      record.state = 'cancelled'; record.revision++; compact(record);
      return { value: receipt(record), changed: true };
    });
  }
  /** 本方法只提供ledger取项边界；调用者仍须在实际传输前markPotentialSend。 */
  async claimNext(businessKey: string, options: { isRead?: (record: Readonly<OperationRecord>) => boolean; excluded?: ReadonlySet<string>; controlOnly?: boolean; onPreparedClaim?: (claim: OperationClaim) => void } = {}): Promise<OperationRecord | null> {
    return this.transaction(async (ledger, authorize) => {
      let changed = false; let denied: unknown;
      const allowed = async (record: OperationRecord, action: Action) => {
        try { await authorize(record, action); return true; } catch (error) { denied ??= error; return false; }
      };
      const records = ledger.records.filter(record => record.context.businessKey === businessKey).sort((a, b) => a.receiveOrder - b.receiveOrder);
      // 只恢复可证明进程已退出且未跨potential-send边界的claim。
      for (const record of records) {
        if (record.state !== 'claimed') continue;
        try { process.kill(record.claimPid!, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') continue;
          if (!await allowed(record, 'transition')) continue; record.state = 'queued'; record.revision++; delete record.claimToken; delete record.claimPid; changed = true;
        }
      }
      for (const record of records) {
        if (record.state === 'queued' && record.control && record.control.expiresAt <= Date.now()) {
          if (!await allowed(record, 'transition')) continue; record.state = 'failed'; record.failure = 'control-expired'; record.revision++; compact(record); changed = true;
        }
      }
      const controlBlocks = new Set(records.filter(record => record.control && !terminal(record)).map(record => record.conversationId));
      // 引导越过排队项后，既有claim/未知结果仍是该会话全部普通写的屏障。
      const activeWrites = new Set(records.filter(record => !record.control && ['claimed', 'uncertain'].includes(record.state) && options.isRead?.(clone(record)) !== true).map(record => record.conversationId));
      const heads = new Set<string>(); const controlHeads = new Set<string>(); const steerHeads = new Set<string>(); const eligible: OperationRecord[] = [];
      for (const record of records) {
        if (terminal(record)) continue;
        if (!record.control && options.isRead?.(clone(record)) === true) {
          if (record.state === 'queued' && !options.excluded?.has(record.id)) eligible.push(record);
          continue;
        }
        if (record.control) {
          if (controlHeads.has(record.conversationId)) continue;
          controlHeads.add(record.conversationId); if (record.state === 'queued' && !options.excluded?.has(record.id)) eligible.push(record); continue;
        }
        if (activeWrites.has(record.conversationId)) continue;
        if (record.state !== 'failed' && record.followUp?.method === 'turn/steer' && record.followUp.expectedTurnId && !controlBlocks.has(record.conversationId)) {
          if (steerHeads.has(record.conversationId)) continue;
          steerHeads.add(record.conversationId); if (record.state === 'queued' && !options.excluded?.has(record.id)) eligible.push(record); continue;
        }
        if (controlBlocks.has(record.conversationId) || heads.has(record.conversationId)) continue;
        heads.add(record.conversationId); if (record.state === 'queued' && !options.excluded?.has(record.id)) eligible.push(record);
      }
      const steer = (record: OperationRecord) => !!record.followUp?.expectedTurnId && record.followUp.method === 'turn/steer';
      const prioritized = [...eligible.filter(record => record.control), ...eligible.filter(record => !record.control && steer(record)), ...eligible.filter(record => !record.control && !steer(record))].filter(record => options.controlOnly === undefined || !!record.control === options.controlOnly);
      let selected: OperationRecord | undefined;
      for (const candidate of prioritized) { if (await allowed(candidate, 'claim')) { selected = candidate; break; } }
      if (!selected) { if (denied) throw denied; return { value: null, changed }; }
      selected.state = 'claimed'; selected.revision++; selected.claimToken = randomUUID(); selected.claimPid = process.pid;
      options.onPreparedClaim?.({ id: selected.id, revision: selected.revision, context: clone(selected.context), claimToken: selected.claimToken });
      return { value: clone(selected), changed: true };
    });
  }
  private claimed(record: OperationRecord, revision: number, token: string): void {
    if (record.revision !== revision) fail('revision-conflict', 409);
    if (!token || record.claimToken !== token) fail('claim-conflict', 409);
  }
  /** 未跨发送标记的内部claim可由原完整授权CAS释放；不得用于uncertain。 */
  async releaseClaim(id: string, revision: number, token: string): Promise<OperationReceipt> {
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, 'transition'); this.claimed(record, revision, token);
      if (record.state !== 'claimed') fail('invalid-transition', 409);
      record.state = 'queued'; record.revision++; delete record.claimToken; delete record.claimPid;
      return { value: receipt(record), changed: true };
    });
  }
  /** 必须耐久成功才可把正文交给传输；从此重启/404/超时都不能自动重发。 */
  async markPotentialSend(id: string, revision: number, token: string): Promise<OperationReceipt> {
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, 'transition'); this.claimed(record, revision, token);
      if (record.state !== 'claimed') fail('invalid-transition', 409);
      if (record.control && record.control.expiresAt <= Date.now()) { record.state = 'failed'; record.failure = 'control-expired'; compact(record); }
      else record.state = 'uncertain'; record.revision++;
      return { value: receipt(record), changed: true };
    });
  }
  /** 仅可信传输对账入口，不接受客户端“未发送”声明；false/异常保留待确认。 */
  async confirmNeverSent(id: string, revision: number, token: string, prove: (record: Readonly<OperationRecord>) => boolean | Promise<boolean>): Promise<OperationReceipt> {
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, 'transition'); this.claimed(record, revision, token);
      if (record.state !== 'uncertain') fail('invalid-transition', 409);
      if (typeof prove !== 'function') fail('not-proven-never-sent', 409);
      const proof = prove(clone(record));
      if ((typeof proof === 'boolean' ? proof : await proof) !== true) fail('not-proven-never-sent', 409);
      await authorize(record, 'transition');
      // 新scheduler传同步真实proof-fence：最后一次授权await不能使原attempt证明过期。
      // 既有异步prove入口保持兼容，不在锁内重复启动外部恢复。
      if (typeof proof === 'boolean' && prove(clone(record)) !== true) fail('not-proven-never-sent', 409);
      record.state = 'queued'; record.revision++; delete record.claimToken; delete record.claimPid;
      return { value: receipt(record), changed: true };
    });
  }
  /** 只接可信上游的确定响应/对账结果；failed仍阻塞，后续确定成功才释放。 */
  async settle(id: string, revision: number, token: string, result: 'succeeded' | 'failed'): Promise<OperationReceipt> {
    return this.transaction(async (ledger, authorize) => {
      const record = this.find(ledger, id); await authorize(record, 'transition'); this.claimed(record, revision, token);
      if (!['uncertain', 'failed'].includes(record.state) || !['succeeded', 'failed'].includes(result)) fail('invalid-transition', 409);
      record.state = result; record.revision++;
      if (result === 'succeeded') compact(record);
      return { value: receipt(record), changed: true };
    });
  }

}
