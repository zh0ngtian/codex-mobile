export const CONVERSATION_TITLE_REQUEST = `<conversation_title_request>
请根据这条用户消息和你即将处理的任务，总结一个简洁的对话标题。标题不超过 40 个字符，语言跟随用户。
请在你对这条消息输出的首条助手回复末尾立即输出下面的隐藏标记，把“标题”替换为总结结果：
<!-- conversation-title: 标题 -->
即使任务还未完成，也必须在首条助手回复中输出且只输出一次，不要等到最终回复。不要解释或重复这个标记。
</conversation_title_request>`;

export const TITLE_PATTERN =
  /[ \t]*<!-- conversation-title:\s*(.*?)\s*-->[ \t]*(?:\r?\n|$)?/g;

const COMPLETE_TITLE_MARKER_PATTERN =
  /[ \t]*<!-- conversation-title:[\s\S]*?-->[ \t]*(?:\r?\n|$)?/g;

const TITLE_REQUEST_SUFFIX = `\n\n${CONVERSATION_TITLE_REQUEST}`;

export function appendConversationTitleRequest(text: string) {
  return text ? `${text}${TITLE_REQUEST_SUFFIX}` : CONVERSATION_TITLE_REQUEST;
}

export function stripConversationTitleRequest(text: string) {
  if (text === CONVERSATION_TITLE_REQUEST) return "";
  return text.endsWith(TITLE_REQUEST_SUFFIX)
    ? text.slice(0, -TITLE_REQUEST_SUFFIX.length)
    : text;
}

export function extractGeneratedTitle(text: string) {
  let title: string | null = null;
  const visibleText = text.replace(TITLE_PATTERN, (_, candidate: string) => {
    const value = candidate.trim();
    if (
      value &&
      value !== "标题" &&
      !/[\r\n]/.test(value) &&
      Array.from(value).length <= 40
    ) {
      title = value;
    }
    return "";
  }).replace(COMPLETE_TITLE_MARKER_PATTERN, "");

  return {
    text: visibleText.trimEnd(),
    title,
  };
}
