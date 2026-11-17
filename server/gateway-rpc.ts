import { snapshotRead } from './remote-read-snapshots.js';
import { performance } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TargetResolver } from './targets.js';
import { OperationScheduler } from './operation-scheduler.js';
import { OperationQueueError, type OperationContext } from './operation-queue.js';
import { HttpSessions, isReadOnlyRpc, readRpcEnvelope, HOSTED_SESSION_ID, type PublicRpcEnvelope, type SessionCallOptions } from './http-session.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SIDECHAT = 'c0dec000-0000-4000-8000-000000000002';
function reject(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }

/** 公共 RPC 只负责协议及受理；真正业务派发唯一归 OperationScheduler。 */
export class GatewayRpc {
  private readonly sessions = new Map<string, HttpSessions>();
  constructor(private resolver: TargetResolver, private scheduler: OperationScheduler) {}
  async hosted(context: OperationContext, id: string, message: import('./http-session.js').RpcMessage, call: SessionCallOptions, queryOnly = false) {
    if (!UUID.test(id)) reject(400, '请求 UUID 无效');
    let original;
    try { original = await this.scheduler.operation(id, context, HOSTED_SESSION_ID, call, { message }); }
    catch (error) {
      if (!(error instanceof OperationQueueError) || error.status !== 404 || queryOnly) throw error;
      await this.scheduler.submit({ id, context, conversationId: String(message.params?.threadId ?? '__gateway__'),
        sessionId: HOSTED_SESSION_ID, requestId: id, message, settings: { source: 'gateway-http-v1' }, attachmentRefs: [] }, call);
    }
    void this.scheduler.runOnce().catch(() => {});
    const until = Math.min(call.deadline, performance.now() + 1500);
    for (;;) {
      const state = original ?? await this.scheduler.operation(id, context, HOSTED_SESSION_ID, call); original = undefined;
      if (state.status === 'completed') return { status: 200, body: state.message! };
      if (queryOnly || performance.now() >= until) return { status: 202, body: { accepted: true, ...state } };
      await new Promise<void>(resolve => setTimeout(resolve, 25)); call.signal?.throwIfAborted();
    }
  }
  async dispatch(context: OperationContext, sessionId: string, envelope: PublicRpcEnvelope, call: SessionCallOptions) {
    if (!UUID.test(sessionId) || [HOSTED_SESSION_ID, SIDECHAT].includes(sessionId)) reject(400, 'Session ID 无效或保留');
    const binding = JSON.stringify(context); const message = envelope.message;
    if (message.method === 'mobile/attachments/upload') reject(403, '附件请求只能由上传入口创建');
    if (['initialize', 'initialized'].includes(message.method ?? '')) {
      const result = await this.scheduler.protocol({ context, sessionId, requestId: envelope.requestId, message }, call);
      if (result.outcome !== 'response') reject(503, '连接初始化未完成');
      if (!(result.message.result as any)?.gateway?.acceptingOffline) this.sessions.set(binding, await this.scheduler.sessionsForTarget(context, call));
      return { status: 200, body: result.message };
    }
    let sessions = this.sessions.get(binding);
    if (sessions && !sessions.consumersAvailable) { this.sessions.delete(binding); sessions = undefined; }
    if (message.method === 'mobile/sidechat/rpc' || sessions?.isEphemeralRpc(message)) {
      sessions ??= await this.scheduler.sessionsForTarget(context, call);
      return { status: 200, body: await sessions.publicRpc(sessionId, envelope, call) };
    }
    if (context.mode === 'local' && isReadOnlyRpc(message)) {
      return { status: 200, body: await this.scheduler.localRead(context, sessionId, envelope, call) };
    }
    try {
      const original = await this.scheduler.operation(envelope.requestId, context, sessionId, call, envelope);
      return original.message ? { status: 200, body: original.message } : { status: 202, body: { accepted: true, ...original } };
    } catch (error) { if (!(error instanceof OperationQueueError) || error.status !== 404) throw error; }
    const conversationId = sessions?.conversationFor(sessionId, message) ??
      (typeof message.params?.threadId === 'string' ? message.params.threadId : message.method === 'thread/start' ? `pending:${envelope.requestId}` : '__gateway__');
    const control = sessions?.controlFor(sessionId, message, envelope.epoch, Math.floor(Date.now() + Math.max(1, call.deadline - performance.now())));
    if (!sessions && (message.method === 'turn/interrupt' || !message.method)) reject(409, '原控制会话不可用');
    const attachmentRefs = (Array.isArray(message.params?.input) ? message.params.input : []).flatMap((part: any) =>
      ['image', 'localImage', 'file'].includes(part?.type) && typeof (part.path ?? part.url) === 'string' ? [part.path ?? part.url] : []);
    await this.scheduler.submit({ id: envelope.requestId, context, conversationId, sessionId, requestId: envelope.requestId,
      message, settings: { source: 'public-rpc-v1', params: message.params ?? {} }, attachmentRefs, ...(envelope.epoch ? { epoch: envelope.epoch } : {}), ...(control ? { control } : {}) }, call);
    void this.scheduler.runOnce().catch(() => {});
    const until = Math.min(call.deadline, performance.now() + 1500);
    do {
      const state = await this.scheduler.operation(envelope.requestId, context, sessionId, call);
      if (state.status === 'completed') return { status: 200, body: state.message! };
      if (performance.now() >= until) return { status: 202, body: { accepted: true, ...state } };
      await new Promise<void>(resolve => setTimeout(resolve, 25));
      call.signal?.throwIfAborted();
    } while (performance.now() < call.deadline);
    reject(503, '请求已受理，请查询原 UUID');
  }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL, reference?: unknown): Promise<void> {
    const controller = new AbortController(); const call = { deadline: performance.now() + 60000, signal: controller.signal };
    const abort = () => controller.abort(); const closed = () => { if (!response.writableFinished) abort(); };
    request.once('aborted', abort); response.once('close', closed);
    const timeout = setTimeout(abort, 60000); timeout.unref();
    response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('cache-control', 'no-store');
    try {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      if (!UUID.test(sessionId) || [HOSTED_SESSION_ID, SIDECHAT].includes(sessionId)) reject(400, 'Session ID 无效或保留');
      const context = await this.resolver.operationContext(reference, controller.signal);
      let value: unknown; let status = 200;
      if (url.pathname === '/api/read-snapshot' && request.method === 'POST') {
        const envelope = await readRpcEnvelope(request);
        if (context.mode !== 'remote' || !snapshotRead(envelope.message)) reject(400, '只允许Remote导航快照读取');
        const fence = await this.resolver.authorizeOperation(context, 'read', controller.signal); fence();
        if (url.searchParams.get('refresh') === '1') {
          const message = await this.scheduler.hostedRpc(context, envelope.message, call);
          if (message.error != null) reject(503, '快照更新失败');
          value = this.scheduler.snapshots.get(context, envelope.message);
          if (!value) reject(404, '快照不可用');
        } else {
          value = this.scheduler.snapshots.get(context, envelope.message);
          if (!value) reject(404, '快照尚未建立');
        }
        fence();
      } else if (url.pathname === '/api/rpc' && request.method === 'POST') {
        const envelope = await readRpcEnvelope(request);
        const result = await this.dispatch(context, sessionId, envelope, call); status = result.status; value = result.body;
      } else if (url.pathname === '/api/events' && request.method === 'GET') {
        value = await this.scheduler.events(context, sessionId, Number(url.searchParams.get('after') ?? '0'), call);
      } else if (url.pathname === '/api/operations' && request.method === 'GET') {
        const id = url.searchParams.get('requestId') ?? ''; if (!UUID.test(id)) reject(400, '请求 UUID 无效');
        const sessions = this.sessions.get(JSON.stringify(context));
        if (context.mode === 'local' && sessions?.hasTransientOperation(sessionId, id)) {
          await sessions.handle(request, response, url); return;
        }
        try { value = await this.scheduler.operation(id, context, sessionId, call); }
        catch (error) {
          // 原 UUID 仅查询已有 WAL，绝不把缺失视为未发送或重试授权。
          if (!(error instanceof OperationQueueError) || error.status !== 404) throw error;
          const sessions = await this.scheduler.sessionsForTarget(context, call);
          await sessions.handle(request, response, url); return;
        }
      } else reject(405, '不支持的请求方法');
      const fence = await this.resolver.authorizeOperation(context, 'read', controller.signal);
      const body = JSON.stringify(value); fence(); controller.signal.throwIfAborted();
      response.statusCode = status; response.end(body);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        response.statusCode = [400, 403, 404, 405, 409, 413, 429, 507].includes((error as any)?.status) ? (error as any).status : 503;
        response.end(JSON.stringify({ error: { code: (error as any)?.code ?? 'rpc-unavailable', message: '请求未完成，请查询原请求或检查连接状态' } }));
      } else response.destroy();
    } finally { clearTimeout(timeout); request.removeListener('aborted', abort); response.removeListener('close', closed); }
  }
}
