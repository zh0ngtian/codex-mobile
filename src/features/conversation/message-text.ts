import { stripGitDirectives, automationAgentMessageText } from '../../ui/conversation';
import { extractGeneratedTitle, stripConversationTitleRequest } from '../../app-server/conversation-title';
type RecordValue = Record<string, any>;
export function messageItemText(item: RecordValue): string {
  let text = Array.isArray(item.content) ? item.content.map((part: RecordValue) => String(part.text ?? '')).join('')
    : String(item.aggregatedOutput ?? item.text ?? (typeof item.content === 'string' ? item.content : '') ?? '');
  if (item.type === 'userMessage') text = stripConversationTitleRequest(text);
  if (item.type === 'agentMessage') text = stripGitDirectives(automationAgentMessageText(extractGeneratedTitle(text).text));
  return text;
}
