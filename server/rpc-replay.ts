/** 普通会话打开恢复订阅；带设置覆盖的 resume 仍需写操作确认。 */
export function isNavigationResume(message: { method?: string; params?: unknown }) {
  const params = message.params;
  return message.method === "thread/resume" && params != null && typeof params === "object" &&
    "threadId" in params && typeof params.threadId === "string" &&
    Object.keys(params).every((key) => ["threadId", "excludeTurns", "initialTurnsPage"].includes(key));
}

/** 与既有Session WAL逐字共用签名序列化（对象无闭括号是既有字节合同）；不引入Node依赖。 */
export function canonicalRpc(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRpc).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalRpc(v)}`).join(',')}`;
  return JSON.stringify(value) ?? 'null';
}
export function rpcSignatureInput(message: { method?: string }, epoch?: string): string {
  return canonicalRpc({ message, ...(!message.method && epoch ? { epoch } : {}) });
}

/** 数字审批保留typed id/原epoch；字符串原绑定兼容，不改实际上游message.id。 */
export function rpcControlRequestKey(id: unknown, epoch?: string): string | undefined {
  return typeof id === 'string' ? id : typeof id === 'number' && Number.isFinite(id) && epoch ? `request:${epoch}:${JSON.stringify(id)}` : undefined;
}
