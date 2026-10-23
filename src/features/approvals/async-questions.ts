import type { RpcMessage } from '../../app-server/client';
import type { InputQuestion } from './approval-model';
import { activeTurnId } from '../../app-server/turn-steering';
import { t } from '../../i18n';

type RecordValue = Record<string, any>;

/** 仅作本地表单身份；它不是等待 JSON-RPC response 的服务器请求。 */
export function isAsyncQuestion(request: RpcMessage) {
  return request.method === 'item/tool/requestUserInput' && (request.params as RecordValue)?.delivery === 'async';
}

export function pendingAsyncQuestions(thread: RecordValue | null): RpcMessage[] {
  if (!thread?.id) return [];
  let pending: RpcMessage[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      // 本地乐观消息尚未被接受，不能据此清理问题或输入。
      if (item.type === 'userMessage' && !String(item.id).startsWith('local-') && !String(turn.id).startsWith('pending-')) pending = [];
      if (item.type !== 'agentMessage' || item.delivery !== 'async' || !item.id || !turn.id || !Array.isArray(item.questions) || !item.questions.length) continue;
      const questions: InputQuestion[] = [];
      for (const [index, question] of item.questions.entries()) {
        if (typeof question?.title !== 'string' || !question.title.trim() ||
          (question.options != null && (!Array.isArray(question.options) || question.options.some((option: unknown) => typeof option !== 'string' || !option.trim())))) break;
        questions.push({ id: `q${index}`, header: `${t('问题')} ${index + 1}`, question: question.title, isOther: true, isSecret: false,
          options: question.options?.length ? [...new Set<string>(question.options)].map(label => ({ label, description: '' })) : null });
      }
      if (questions.length !== item.questions.length) continue;
      pending.push({ id: `async-question:${JSON.stringify([thread.id, turn.id, item.id])}`, method: 'item/tool/requestUserInput',
        params: { threadId: thread.id, turnId: turn.id, itemId: item.id, delivery: 'async', questions } });
    }
  }
  return pending;
}

export function asyncQuestionText(request: RpcMessage, result: unknown): string {
  const questions: InputQuestion[] = (request.params as RecordValue).questions;
  const answers = (result as RecordValue)?.answers;
  return questions.map(question => {
    const values = answers?.[question.id]?.answers;
    if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value.trim())) throw new Error('请回答所有问题后提交。');
    return `${question.question}\n${values.join('\n')}`;
  }).join('\n\n');
}

export async function sendAsyncQuestionAnswer(request: RpcMessage, result: unknown, thread: RecordValue,
  client: { request(method: string, params: RecordValue): Promise<any> }, clientUserMessageId: string) {
  const threadId = (request.params as RecordValue).threadId;
  if (thread.id !== threadId || !pendingAsyncQuestions(thread).some(candidate => candidate.id === request.id)) throw new Error('问题已变化，请重新打开后回答');
  const turnId = activeTurnId(thread);
  return client.request(turnId ? 'turn/steer' : 'turn/start', {
    threadId, clientUserMessageId, input: [{ type: 'text', text: asyncQuestionText(request, result), text_elements: [] }],
    ...(turnId ? { expectedTurnId: turnId } : {}),
  });
}
