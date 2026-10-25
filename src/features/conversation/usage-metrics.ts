type UsageSnapshot = Record<string, any> | null | undefined;

/** 十进制字节单位，与界面的 KB/MB 名称保持一致。 */
export function formatByteCount(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let amount = value;
  let unit = 0;
  while (amount >= 999.95 && unit < units.length - 1) { amount /= 1000; unit++; }
  return `${Math.round(amount * 10) / 10} ${units[unit]}`;
}

const validNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/** 当前上下文只使用最近一次请求，累计总量另行展示。 */
export function contextUsageMetrics(tokenUsage: UsageSnapshot) {
  const used = tokenUsage?.last?.totalTokens;
  const total = tokenUsage?.modelContextWindow;
  if (!validNumber(used) || !validNumber(total) || total === 0) return null;
  const usedPercent = clampPercent(used / total * 100);
  return { used, total, usedPercent, remainingPercent: 100 - usedPercent };
}

export function contextRemainingPercent(tokenUsage: UsageSnapshot): number | null {
  const context = contextUsageMetrics(tokenUsage);
  return context ? Math.round(context.remainingPercent) : null;
}

/** 严格匹配窗口长度，不依赖 primary/secondary 的排列。 */
export function rateLimitMetrics(rateLimits: UsageSnapshot, durationMins: 300 | 10080) {
  const snapshot = rateLimits?.rateLimits ?? rateLimits;
  const window = [snapshot?.primary, snapshot?.secondary].find(entry =>
    entry?.windowDurationMins === durationMins && validNumber(entry?.usedPercent),
  );
  if (!window) return null;
  return {
    remainingPercent: Math.round(clampPercent(100 - window.usedPercent)),
    windowDurationMins: durationMins,
    ...(validNumber(window.resetsAt) && window.resetsAt > 0 ? { resetsAt: window.resetsAt } : {}),
  };
}

export function rateLimitRemainingPercent(rateLimits: UsageSnapshot, durationMins: 300 | 10080): number | null {
  return rateLimitMetrics(rateLimits, durationMins)?.remainingPercent ?? null;
}

/** 缓存命中率使用累计输入；零输入没有可计算的分母。 */
export function inputCacheHitPercent(tokenUsage: UsageSnapshot): number | null {
  const input = tokenUsage?.total?.inputTokens;
  const cached = tokenUsage?.total?.cachedInputTokens;
  if (!validNumber(input) || input === 0 || !validNumber(cached) || cached > input) return null;
  return Math.round(cached / input * 1000) / 10;
}

/** 十进制 K/M，最多一位小数；K 舍入到 1000 时提升为 M。 */
export function formatTokenCount(value: unknown): string | null {
  if (!validNumber(value)) return null;
  const rounded = (number: number) => String(Math.round(number * 10) / 10);
  if (value < 1000) return rounded(value);
  const thousands = Math.round(value / 100) / 10;
  if (thousands < 1000) return `${thousands}K`;
  return `${rounded(value / 1_000_000)}M`;
}
