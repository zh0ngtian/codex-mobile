import { imageSourcesForItem } from './conversation';

type Item = Record<string, any>;
const isGenerated = (item: Item) => item.type === 'imageGeneration' || item.type === 'videoGeneration';
const sourceFor = (item: Item) => imageSourcesForItem(item)[0]?.source ||
  (item.type === 'videoGeneration' ? item.savedPath ?? item.path ?? item.result : '');

/** 在整轮去重后保留原始位置，生成结果优先于同源查看截图。 */
export function orderedTurnMedia(items: Item[]): Item[] {
  const generated = new Set(items.filter(item => isGenerated(item) && item.status !== 'failed').map(sourceFor).filter(Boolean));
  const seen = new Set<string>();
  return items.filter(item => {
    if (!isGenerated(item) && item.type !== 'imageView') return true;
    if (item.status === 'failed') return true;
    const source = sourceFor(item);
    if (!source) return true;
    if (seen.has(source) || (item.type === 'imageView' && generated.has(source))) return false;
    seen.add(source);
    return true;
  });
}

/** 截图归属于此前最近的 commentary，用户插话和其他助手正文会结束关联。 */
export function commentaryMediaEntries(items: Item[]): Array<{ item: Item; media: Item[] }> {
  const entries: Array<{ item: Item; media: Item[] }> = [];
  let commentary: { item: Item; media: Item[] } | undefined;
  for (const item of items) {
    if (item.type === 'imageView' && commentary) {
      commentary.media.push(item);
      continue;
    }
    const entry = { item, media: [] as Item[] };
    entries.push(entry);
    if (item.type === 'agentMessage' || item.type === 'userMessage') {
      commentary = item.type === 'agentMessage' && item.phase === 'commentary' ? entry : undefined;
    } else if (isGenerated(item)) {
      // 生成产物有自己的展示位置，后续截图不能跨过它回跳到较早 commentary。
      commentary = undefined;
    }
  }
  return entries;
}
