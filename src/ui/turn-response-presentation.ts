import { splitCompletedTurnResponses, type ConversationRecord } from './conversation';
import { commentaryMediaEntries, orderedTurnMedia } from './timeline-media';

export type TurnResponseEntry = ReturnType<typeof commentaryMediaEntries>[number] & {
  history: boolean;
  supersededAnswer: boolean;
};

/** 仅整理单个逻辑回合的展示；先绑定媒体，再移动引导，始终保留原 item。
 * collapseWithoutFinal 保留各端已结束但无 final 时的既有过程策略，不影响引导与旧回答归属。
 */
export function turnResponsePresentation(responses: ConversationRecord[], { running, collapseWithoutFinal = false }: { running: boolean; collapseWithoutFinal?: boolean }) {
  const ordered = orderedTurnMedia(responses);
  const steering = ordered.filter(item => item.type === 'userMessage');
  const lastSteeringIndex = steering.length ? ordered.lastIndexOf(steering.at(-1)!) : -1;
  // 引导之前的旧 final 不能让尚在执行的新响应冒充完成。
  const final = splitCompletedTurnResponses(ordered.slice(lastSteeringIndex + 1), { allowLegacyFinal: !running }).final;
  const entries: TurnResponseEntry[] = commentaryMediaEntries(ordered).map(entry => {
    const assistant = entry.item.type === 'agentMessage';
    const commentary = assistant && entry.item.phase === 'commentary';
    const supersededAnswer = assistant && !commentary && steering.length > 0 &&
      (ordered.indexOf(entry.item) < lastSteeringIndex || (final != null && entry.item !== final));
    const history = supersededAnswer || (commentary && ((!running && collapseWithoutFinal) || final != null || ordered.indexOf(entry.item) < lastSteeringIndex));
    return { ...entry, history, supersededAnswer };
  });
  return {
    final,
    entries: steering.length ? [...entries.filter(entry => entry.item.type === 'userMessage'), ...entries.filter(entry => entry.item.type !== 'userMessage')] : entries,
    historyCount: entries.filter(entry => entry.history).length,
  };
}
