import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

type Value = Record<string, any>;
/** 恢复已结束的分支上下文；工具记录作为历史文字注入，不重新调用工具。 */
export async function sidechatReplayItems(turns: Value[]) {
  const items: Value[] = [];
  for (const turn of turns) for (const item of turn.items ?? []) {
    if (item.type === 'userMessage') {
      const content: Value[] = [];
      for (const part of item.content ?? []) {
        if (part.type === 'text') content.push({ type: 'input_text', text: part.text });
        else if (['image', 'localImage'].includes(part.type)) {
          let url = part.url ?? part.path;
          if (typeof url === 'string' && url.startsWith('/')) {
            const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extname(url).toLowerCase()] ?? 'image/png';
            url = `data:${mime};base64,${(await readFile(url)).toString('base64')}`;
          }
          content.push({ type: 'input_image', image_url: url });
        } else content.push({ type: 'input_text', text: JSON.stringify(part) });
      }
      if (!content.length && typeof item.text === 'string') content.push({ type: 'input_text', text: item.text });
      if (content.length) items.push({ type: 'message', role: 'user', content });
    } else {
      const text = item.type === 'agentMessage' ? item.text : `已完成的历史记录，仅作上下文，不重复执行：\n${JSON.stringify(item)}`;
      if (text) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
    }
  }
  return items;
}
