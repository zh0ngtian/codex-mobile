type ThreadRecord = Record<string, any>;

const auxiliarySource = /^(?:subAgent(?:Review|Compact|ThreadSpawn|Other)?|internal)$/i;

/** 仅按明确的来源与生命周期证据隐藏辅助会话，标题和用户复制不参与分类。 */
export function isVisibleThread(thread: ThreadRecord) {
  if (thread.ephemeral === true || thread.parentThreadId) return false;
  for (const source of [thread.source, thread.sourceKind, thread.threadSource]) {
    if (typeof source === "string" && auxiliarySource.test(source)) return false;
    if (source && typeof source === "object" &&
      ["subAgent", "subagent", "internal"].some((key) => Object.hasOwn(source, key))) {
      return false;
    }
  }
  return true;
}
