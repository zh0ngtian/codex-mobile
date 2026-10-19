import type { RpcMessage } from './http-session.js';
type Value = Record<string, any>;
const terminal = new Set(['completed', 'failed', 'interrupted', 'cancelled']);
interface Entry { settings: Value; thread: Value; parentId: string; forkTurnId: string; lastActiveAt: number; busy: boolean }
/** daemon 生命周期内的完整内存投影。没有文件、数据库或转储出口。 */
export class SidechatHistory {
  private entries = new Map<string, Entry>();
  constructor(private now = Date.now) {}
  get size() { return this.entries.size; }
  has(id: unknown) { return typeof id === 'string' && this.entries.has(id); }
  register(params: Value, result: Value) {
    if (!result.thread?.id || result.thread.ephemeral !== true) throw new Error('Codex 未返回临时 Sidechat');
    const thread = { ...result.thread, turns: [] };
    this.entries.set(thread.id, { settings: { ...result, thread: undefined }, thread, parentId: params.threadId, forkTurnId: params.lastTurnId, lastActiveAt: this.now(), busy: false });
    return this.read(thread.id);
  }
  read(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Sidechat 已失效，daemon 可能已重启，请返回主聊天重新创建');
    entry.lastActiveAt = this.now();
    return structuredClone({ ...entry.settings, thread: entry.thread, parentId: entry.parentId, forkTurnId: entry.forkTurnId, busy: entry.busy });
  }
  remove(id: string) { this.entries.delete(id); }
  clear() { this.entries.clear(); }
  expired() { return [...this.entries].filter(([, e]) => !e.busy && this.now() - e.lastActiveAt >= 24 * 3600000).map(([id]) => id); }
  settings(id: string, params: Value) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.settings = { ...entry.settings, ...params, reasoningEffort: params.effort ?? entry.settings.reasoningEffort };
  }
  observe(message: RpcMessage) {
    const p = message.params ?? {}; const entry = this.entries.get(p.threadId);
    if (!entry) return false;
    const turnId = p.turn?.id ?? p.turnId;
    if (turnId === entry.forkTurnId) return true;
    if (message.method === 'thread/closed') { this.remove(p.threadId); return true; }
    let turn = entry.thread.turns.find((t: Value) => t.id === turnId);
    if (turnId && !turn) { turn = { id: turnId, status: 'inProgress', items: [] }; entry.thread.turns.push(turn); }
    if (message.method === 'turn/started' && !terminal.has(turn.status)) { Object.assign(turn, { ...p.turn, items: turn.items }); entry.busy = !terminal.has(turn.status); }
    if (message.method === 'turn/completed') {
      Object.assign(turn, { ...p.turn, status: p.turn?.status ?? 'completed', items: mergeItems(turn.items, p.turn?.items ?? []) });
      entry.busy = false; entry.lastActiveAt = this.now();
    }
    if (p.item && turn) turn.items = mergeItems(turn.items, [{ timestamp: this.now() / 1000, ...p.item }]);
    if (p.delta && turn && p.itemId) {
      let item = turn.items.find((i: Value) => i.id === p.itemId);
      if (!item) { item = { id: p.itemId, type: message.method?.includes('agentMessage') ? 'agentMessage' : 'reasoning', text: '' }; turn.items.push(item); }
      const field = /commandExecution|fileChange/.test(message.method ?? '') ? 'aggregatedOutput' : 'text';
      item[field] = (item[field] ?? '') + p.delta;
    }
    if (message.method === 'turn/plan/updated') entry.thread.mobilePlan = p.plan ?? [];
    if (message.method === 'thread/tokenUsage/updated') entry.thread.tokenUsage = p.tokenUsage;
    if (message.method === 'thread/status/changed') entry.thread.status = p.status;
    return true;
  }
}
function mergeItems(previous: Value[], incoming: Value[]) {
  const result = previous.map(item => ({ ...item }));
  for (const item of incoming) { const index = result.findIndex(old => old.id === item.id); if (index < 0) result.push(item); else result[index] = { ...result[index], ...item }; }
  return result;
}
