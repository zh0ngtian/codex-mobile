import type { HttpSyncState } from "../../backends/http-transport";
import { useEffect, useState } from "react";
import { t } from "../../i18n";

export function RunProgress({ thread, busy, sync }: { thread: Record<string, any>; busy: boolean; sync: HttpSyncState | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy && !sync?.stale) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [busy, sync?.stale]);
  if (!busy && !sync?.stale) return null;
  const flags: string[] = thread.status?.activeFlags ?? [];
  const turn = thread.turns?.at(-1);
  const items: Record<string, any>[] = turn?.items ?? [];
  const current = [...items].reverse().find((item) => ["inProgress", "in_progress", "running"].includes(item.status));
  const labels: Record<string, string> = {
    commandExecution: t("正在执行命令"), fileChange: t("正在修改文件"),
    mcpToolCall: t("正在调用工具"), webSearch: t("正在搜索"), reasoning: t("正在分析"),
    agentMessage: t("正在生成回复"), imageGeneration: t("正在生成图像"),
  };
  const label = flags.includes("waitingOnApproval") ? t("等待你确认")
    : flags.includes("waitingOnUserInput") ? t("等待你的回答")
    : labels[current?.type] ?? t("任务进行中");
  const detail = current?.command ?? current?.tool ?? "";
  const plan: Array<{ step: string; status: string }> = busy ? thread.mobilePlan ?? [] : [];
  return <section className="run-progress" aria-label={t("执行状态")}>
    <strong>{label}{detail ? ` · ${String(detail).slice(0, 120)}` : ""}</strong>
    {plan.length > 0 && <ol>{plan.map((entry, index) => <li key={index} data-status={entry.status}>
      <span aria-hidden="true">{entry.status === "completed" ? "✓" : entry.status === "inProgress" ? "●" : "○"}</span> {entry.step}
    </li>)}</ol>}
    {sync?.stale && <span>{t("连接暂时不可用，正在重试")}</span>}
    {sync?.updatedAt && <small>{t("最近同步：{seconds} 秒前", { seconds: Math.max(0, Math.floor((now - sync.updatedAt) / 1_000)) })}</small>}
  </section>;
}
