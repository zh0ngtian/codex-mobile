/** 普通会话打开恢复订阅；带设置覆盖的 resume 仍需写操作确认。 */
export function isNavigationResume(message: { method?: string; params?: unknown }) {
  const params = message.params;
  return message.method === "thread/resume" && params != null && typeof params === "object" &&
    "threadId" in params && typeof params.threadId === "string" &&
    Object.keys(params).every((key) => ["threadId", "excludeTurns", "initialTurnsPage"].includes(key));
}
