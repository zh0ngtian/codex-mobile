async function pages(rpc, method, params = {}) {
  const data = [], seen = new Set();
  let cursor;
  do {
    const result = await rpc(method, { ...params, limit: 100, ...(cursor ? { cursor } : {}) });
    if (!result || !Array.isArray(result.data)) throw new Error('invalid page');
    data.push(...result.data);
    cursor = result.nextCursor;
    if (cursor != null && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) throw new Error('invalid cursor');
    if (cursor) seen.add(cursor);
    if (seen.size > 200) throw new Error('too many pages');
  } while (cursor);
  return data;
}

export async function readIdleState(rpc) {
  try {
    const ids = await pages(rpc, 'thread/loaded/list');
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('invalid threads');
    for (const id of ids) {
      const result = await rpc('thread/read', { threadId: id, includeTurns: false });
      if (result?.thread?.id !== id || result.thread.status?.type !== 'idle') return { idle: false, reason: 'thread-active-or-unknown' };
      if ((await pages(rpc, 'thread/backgroundTerminals/list', { threadId: id })).length) return { idle: false, reason: 'background-terminal' };
    }
    const after = await pages(rpc, 'thread/loaded/list');
    if (after.length !== ids.length || after.some((id) => !ids.includes(id))) return { idle: false, reason: 'threads-changed' };
    return { idle: true, reason: 'idle' };
  } catch {
    return { idle: false, reason: 'state-unavailable' };
  }
}

export class IdleUpdatePolicy {
  constructor({ idleMs = 30_000, cooldownMs = 300_000 } = {}) {
    this.idleMs = idleMs; this.cooldownMs = cooldownMs;
    this.target = null; this.idleSince = null; this.retry = null;
  }
  invalidate() { this.idleSince = null; }
  observe({ current, target, idle, now }) {
    if (target !== this.target) { this.target = target; this.invalidate(); }
    if (!target || target === current || idle !== true || (this.retry?.target === target && now < this.retry.until)) {
      this.invalidate(); return false;
    }
    if (this.idleSince === null) this.idleSince = now;
    return now - this.idleSince >= this.idleMs;
  }
  failed(target, now) { this.retry = { target, until: now + this.cooldownMs }; this.invalidate(); }
}
