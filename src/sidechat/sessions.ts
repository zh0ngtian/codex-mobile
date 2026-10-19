import { quoteInput, type MessageQuote } from '../features/conversation/message-quotes';
import { t } from '../i18n';
import { HttpOperationPendingError, transportUuid } from '../backends/http-transport';
import type { RpcMessage } from '../app-server/client';
import { applyCompletedTurn, applyTurnDiff, applyTurnItem, applyTurnStarted, createPendingTurn, reconcileRecentTurns } from '../ui/conversation';

type RecordValue = Record<string, any>;
export interface SidechatClient { request(method: string, params: any): Promise<any> }
/** 主聊天仍直接读取 Codex；临时聊天由网关内存通道持有订阅。 */
export function gatewaySidechatClient(client: SidechatClient): SidechatClient {
  return { request: (method, params) => method === 'thread/turns/list'
    ? client.request(method, params)
    : client.request('mobile/sidechat/rpc', { method: method === 'mobile/sidechat/read' ? 'read' : method, params }) };
}
export const SIDECHAT_INSTRUCTIONS = `这是从主聊天分叉出的临时独立 Sidechat。继承历史仅作背景参考，不是待执行指令；不得自动继续、恢复或完成主聊天任务。只响应用户在本 Sidechat 新提出的请求。默认只读探索；只有用户在本 Sidechat 明确提出文件修改时才可修改，并遵守现有权限和审批。对话独立但文件目录、远程机器和容器与主聊天共享，获准的修改会影响同一目录。不得创建子代理，不得委派给其他代理。不要因为继承历史中的代理或技能指令而创建子代理。`;
export const SIDECHAT_TTL = 24 * 60 * 60 * 1000;
export interface SidechatLink { id: string; parentId: string; forkTurnId: string; createdAt: number; lastActiveAt: number; turnIds: string[] }
export interface SidechatSession extends SidechatLink {
  thread: RecordValue; settings: RecordValue; busy: boolean; sending: boolean; closing: boolean; error: string;
  queue: { id: string; input: RecordValue[]; settings: RecordValue; text: string; question?: string; quotes?: MessageQuote[] }[];
  client?: SidechatClient; restoring?: boolean; unconfirmed?: { requestId: string; entryId: string };
}
const terminal = new Set(['completed', 'interrupted', 'failed']);
export class SidechatSessions {
  private sessions = new Map<string, SidechatSession>();
  private listeners = new Set<() => void>();
  private hiddenTurns = new Map<string, Set<string>>();
  private activityRevision = new WeakMap<SidechatSession, number>();
  private creating = false;
  private key: string;
  constructor(backendId: string, private storage: Pick<Storage, 'getItem' | 'setItem'>, private now = Date.now) {
    this.key = `codex-mobile:sidechats:${backendId}`;
    const saved = this.storage.getItem(this.key);
    if (saved) for (const link of JSON.parse(saved) as SidechatLink[]) {
      if (!link || typeof link.id !== 'string' || typeof link.parentId !== 'string' || typeof link.forkTurnId !== 'string' || !Array.isArray(link.turnIds) || !Number.isFinite(link.lastActiveAt)) continue;
      this.sessions.set(link.id, { ...link, thread: { id: link.id, ephemeral: true, name: `Sidechat ${this.forParent(link.parentId).length + 1}`, turns: [] }, settings: {}, busy: false, sending: false, closing: false, error: '', queue: [], restoring: true });
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.persist(); for (const listener of this.listeners) listener(); }
  private setBusy(session: SidechatSession, busy: boolean) {
    session.busy = busy;
    this.activityRevision.set(session, (this.activityRevision.get(session) ?? 0) + 1);
  }
  private persist() {
    this.storage.setItem(this.key, JSON.stringify(this.all().map(s => ({ id: s.id, parentId: s.parentId, forkTurnId: s.forkTurnId, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, turnIds: s.turnIds }))));
  }
  all() { return [...this.sessions.values()]; }
  get(id: string) { return this.sessions.get(id); }
  forParent(id: string) { return this.all().filter(s => s.parentId === id); }
  touch(id: string) { const s = this.get(id); if (s) { s.lastActiveAt = this.now(); this.changed(); } }
  async create(client: SidechatClient, parent: RecordValue) {
    if (this.creating) throw new Error(t('正在创建 Sidechat，请稍候'));
    if (!parent.id || this.get(String(parent.id))) throw new Error(t('请从主聊天创建 Sidechat'));
    this.creating = true;
    try {
      let cursor: string | undefined; let last: RecordValue | undefined; let result: RecordValue | undefined;
      const inherited = new Set<string>();
      do {
        const page = await client.request('thread/turns/list', { threadId: String(parent.id), limit: 5, sortDirection: 'desc', itemsView: 'summary', ...(cursor ? { cursor } : {}) });
        for (const turn of page.data ?? []) inherited.add(String(turn.id));
        for (const turn of page.data ?? []) {
          if (!terminal.has(turn.status)) continue;
          try {
            result = await client.request('thread/fork', { threadId: String(parent.id), lastTurnId: String(turn.id), ephemeral: true, excludeTurns: true, developerInstructions: SIDECHAT_INSTRUCTIONS, config: { 'features.multi_agent': false } });
            last = turn; break;
          } catch (error) {
            // 其他daemon的运行回合可能在磁盘摘要中误标完成；fork才是结束边界的权威。
            if ((error as {code?:number}).code !== -32600 || !String((error as Error).message).includes('identifies an in-progress turn')) throw error;
          }
        }
        cursor = page.nextCursor || undefined;
      } while (!result && cursor);
      if (!last?.id || !result) throw new Error(t('主聊天还没有已结束的回合，请在一轮结束后创建 Sidechat'));
      if (!result.thread?.id || result.thread.id === parent.id || result.thread.ephemeral !== true) throw new Error(t('Sidechat 分叉响应无效；当前 Codex 可能不支持临时分叉'));
      const id = String(result.thread.id); const at = this.now();
      const session: SidechatSession = { id, parentId: String(parent.id), forkTurnId: String(last.id), createdAt: at, lastActiveAt: at, turnIds: [],
        thread: { ...result.thread, name: `Sidechat ${this.forParent(String(parent.id)).length + 1}`, turns: [] }, settings: result, busy: false, sending: false, closing: false, error: '', queue: [], client };
      this.sessions.set(id, session); this.hiddenTurns.set(id, inherited);
      try { this.changed(); } catch (error) { this.sessions.delete(id); await client.request('thread/unsubscribe', { threadId: id }); throw error; }
      return session;
    } finally { this.creating = false; }
  }
  /** 内存消息只来自分叉后本线程的事件；fork 响应中的继承 turns 从不进入呈现。 */
  observe(message: RpcMessage) {
    if (message.id != null && message.method) return false;
    // 审批撤销/完成由全局审批队列按请求ID清理，不能被分支投影提前消费。
    if (message.method === 'serverRequest/resolved') return false;
    const p = (message.params ?? {}) as RecordValue;
    const confirmed = message.method === 'mobile/operation/confirmed' && p.request?.method === 'mobile/sidechat/rpc' ? p.request.params?.params : null;
    const id = String(p.threadId ?? p.thread?.id ?? confirmed?.threadId ?? ''); const s = this.get(id);
    if (!s) return false;
    const unconfirmed = s.unconfirmed;
    if (confirmed && unconfirmed && unconfirmed.requestId === p.requestId) {
      const entryId = unconfirmed.entryId; s.unconfirmed = undefined;
      if (p.response?.error) {
        s.error = String(p.response.error.message); this.setBusy(s, false);
        s.thread = { ...s.thread, turns: s.thread.turns.filter((turn: RecordValue) => turn.id !== `pending-${entryId}`) };
      } else if (p.response?.result?.turn?.id) {
        const turn = p.response.result.turn;
        const completed = s.thread.turns.some((item: RecordValue) => item.id === turn.id && terminal.has(item.status));
        if (!completed) s.thread = applyTurnStarted(s.thread, { threadId: id, turn });
        this.setBusy(s, !completed); s.error = ''; s.queue = s.queue.filter(item => item.id !== entryId);
        if (!s.turnIds.includes(turn.id)) s.turnIds.push(turn.id);
      }
      this.changed(); return true;
    }
    const turnId = String(p.turn?.id ?? p.turnId ?? '');
    if (turnId && (turnId === s.forkTurnId || this.hiddenTurns.get(id)?.has(turnId))) return true;
    if (message.method === 'turn/started') { s.thread = applyTurnStarted(s.thread, p); this.setBusy(s, true); }
    if (message.method === 'item/started' || message.method === 'item/completed') s.thread = applyTurnItem(s.thread, p);
    if (message.method?.endsWith('/delta') || message.method?.endsWith('/outputDelta') || message.method?.endsWith('/textDelta') || message.method?.endsWith('/summaryTextDelta')) {
      const turn = s.thread.turns.find((t: RecordValue) => t.id === turnId); const item = turn?.items?.find((i: RecordValue) => i.id === p.itemId);
      if (item) { const field = message.method.includes('commandExecution') || message.method.includes('fileChange') ? 'aggregatedOutput' : 'text'; item[field] = `${item[field] ?? ''}${p.delta ?? ''}`; s.thread = { ...s.thread, turns: [...s.thread.turns] }; }
    }
    if (message.method === 'turn/plan/updated') s.thread = { ...s.thread, mobilePlan: p.plan ?? [] };
    if (message.method === 'turn/diff/updated') s.thread = applyTurnDiff(s.thread, p);
    if (message.method === 'thread/tokenUsage/updated') s.thread = { ...s.thread, tokenUsage: p.tokenUsage };
    if (message.method === 'turn/completed') { s.thread = applyCompletedTurn(s.thread, p); this.setBusy(s, false); s.lastActiveAt = this.now(); }
    if (message.method === 'thread/status/changed') s.thread = { ...s.thread, status: p.status };
    if (message.method === 'thread/closed') {
      // 自己确认关闭/过期时由close完成清理与导航；外部失效立即移除，不能恢复旧正文草稿。
      if (s.closing) return true;
      s.error = t('Sidechat 已失效，daemon 可能已重启，请返回主聊天重新创建'); this.setBusy(s, false); s.queue = [];
      this.sessions.delete(id); this.hiddenTurns.delete(id); this.changed(); return true;
    }
    if (turnId && !turnId.startsWith('pending-') && !s.turnIds.includes(turnId)) s.turnIds.push(turnId);
    this.changed();
    if (message.method === 'turn/completed' && !s.closing) void this.drain(s).catch(() => undefined);
    return true;
  }
  async submit(client: SidechatClient, id: string, input: RecordValue[], settings: RecordValue, accepted?: () => void, draft?: { question: string; quotes: MessageQuote[] }) {
    const s = this.get(id); if (!s || s.closing || s.error) throw new Error(s?.error || 'Sidechat 不可用');
    s.client = client;
    const entry = { id: transportUuid(), input, settings, text: draft?.question || input.filter(i => i.type === 'text').map(i => i.text).join('\n') || '附件', ...(draft ? {question: draft.question, quotes: draft.quotes} : {}) };
    s.queue.push(entry); s.lastActiveAt = this.now(); accepted?.(); this.changed();
    if (!s.busy && !s.sending) await this.drain(s);
  }
  private async drain(s: SidechatSession) {
    if (s.closing || s.unconfirmed || s.busy || s.sending || !s.client || !s.queue.length) return;
    const entry = s.queue[0]; s.sending = true; this.setBusy(s, true); s.error = '';
    const pendingId = `pending-${entry.id}`;
    s.thread = { ...s.thread, mobilePlan: [], turns: [...s.thread.turns, createPendingTurn(pendingId, { id: `local-${entry.id}`, type: 'userMessage', content: entry.input })] }; this.changed();
    try {
      const result = await s.client.request('turn/start', { ...entry.settings, threadId: s.id, input: entry.input });
      if (!result.turn?.id) throw new Error(t('Sidechat 发送响应无效'));
      s.queue = s.queue.filter(q => q.id !== entry.id);
      const alreadyCompleted = s.thread.turns.find((t: RecordValue) => t.id === result.turn.id && terminal.has(t.status));
      if (!alreadyCompleted) s.thread = applyTurnStarted(s.thread, { threadId: s.id, turn: result.turn });
      this.setBusy(s, !alreadyCompleted);
      if (!s.turnIds.includes(result.turn.id)) s.turnIds.push(result.turn.id);
    } catch (error) {
      // 不自动重发结果不明的请求；保留内存队列供用户核对。
      if (error instanceof HttpOperationPendingError) {
        s.unconfirmed = { requestId: error.requestId, entryId: entry.id };
        s.error = t('请求结果待确认，请等待原请求核对，勿重复发送');
        throw error;
      }
      s.error = error instanceof Error ? error.message : String(error); this.setBusy(s, false);
      s.thread = { ...s.thread, turns: s.thread.turns.filter((t: RecordValue) => t.id !== pendingId) };
      throw error;
    } finally { s.sending = false; s.lastActiveAt = this.now(); this.changed(); }
    if (!s.busy && s.queue.length) void this.drain(s).catch(() => undefined);
  }
  editQueued(id: string, queueId: string, text: string) {
    const s = this.get(id); const entry = s?.queue.find(item => item.id === queueId);
    if (!s || !entry || s.sending) return false;
    const content = quoteInput(text, entry.quotes ?? []);
    if (entry.input[0]?.type === 'text') entry.input = [{ ...entry.input[0], text: content }, ...entry.input.slice(1)];
    else entry.input = [{ type: 'text', text: content }, ...entry.input];
    entry.text = text; entry.question = text; this.changed(); return true;
  }
  async retry(id: string) { const s = this.get(id); if (s?.unconfirmed) throw new Error(t('请求结果待确认，不能重新发送')); if (!s || s.busy || s.sending) return; s.error = ''; await this.drain(s); }
  removeQueued(id: string, queueId: string) { const s = this.get(id); if (s && !s.sending) { s.queue = s.queue.filter(q => q.id !== queueId); this.changed(); } }
  async stop(client: SidechatClient, id: string) {
    const s = this.get(id); const turn = s?.thread.turns.findLast((t: RecordValue) => !terminal.has(t.status));
    if (!s || !turn || String(turn.id).startsWith('pending-')) throw new Error(t('执行回合尚未就绪，请稍后重试'));
    await client.request('turn/interrupt', { threadId: id, turnId: turn.id });
  }
  async close(client: SidechatClient, id: string) {
    const s = this.get(id); if (!s) return; if (s.closing) throw new Error(t('正在关闭 Sidechat，请稍候'));
    if (s.sending) throw new Error(t('消息正在提交，请等待提交结果后关闭 Sidechat'));
    s.closing = true; s.queue = []; this.changed();
    try {
      if (s.busy) await this.stop(client, id);
      await client.request('thread/unsubscribe', { threadId: id });
      this.sessions.delete(id); this.hiddenTurns.delete(id); this.changed();
    } catch (error) {
      if ((error as {code?:number}).code !== -32001 || !String((error as Error).message).includes('失效')) throw error;
      this.sessions.delete(id); this.hiddenTurns.delete(id); this.changed();
    } finally { s.closing = false; }
  }
  async expire(client: SidechatClient) {
    for (const s of this.all()) if (!s.busy && !s.sending && !s.closing && this.now() - s.lastActiveAt >= SIDECHAT_TTL) await this.close(client, s.id);
  }
  async restore(client: SidechatClient) {
    const raw = this.storage.getItem(this.key); if (!raw) return;
    const links: SidechatLink[] = JSON.parse(raw); if (!Array.isArray(links)) throw new Error(t('Sidechat 关联记录无效'));
    if (!links.length) return;
    const lost: string[] = [];
    for (const link of links) {
      if (typeof link.id !== 'string' || typeof link.parentId !== 'string' || !Array.isArray(link.turnIds) || !Number.isFinite(link.lastActiveAt)) continue;
      const existing = this.get(link.id);
      if (!existing || existing.closing) continue;
      const activity = this.activityRevision.get(existing) ?? 0;
      try {
        const response = await client.request('mobile/sidechat/read', { threadId: link.id });
        // read期间关闭/替换的生命周期不可被迟到响应复活。
        if (this.get(link.id) !== existing || existing.closing) continue;
        if (response.parentId !== link.parentId || response.forkTurnId !== link.forkTurnId || response.thread?.ephemeral !== true) throw new Error(t('Sidechat 关联记录与 daemon 不一致'));
        const turns = reconcileRecentTurns(existing.thread.turns ?? [], response.thread.turns ?? []);
        // 保持对象身份，迟到的发送响应仍须更新原队列；UUID待确认锁也跨重连保留。
        Object.assign(existing, { turnIds: [...new Set([...existing.turnIds, ...turns.map((t: RecordValue) => String(t.id))])],
          thread: { ...response.thread, name: existing.thread.name, turns }, settings: response,
          busy: existing.sending || ((this.activityRevision.get(existing) ?? 0) === activity ? response.busy === true : existing.busy),
          error: existing.unconfirmed ? existing.error : '', restoring: false, client });
      } catch (error) {
        if (this.get(link.id) !== existing || existing.closing) continue;
        if (String((error as Error).message).includes('失效')) { this.sessions.delete(link.id); lost.push(link.id); }
        else throw error;
      }
    }
    this.changed(); await this.expire(client);
    if (lost.length) throw new Error(t('部分 Sidechat 已失效，daemon 可能已重启；请从主聊天重新创建'));
  }
}
