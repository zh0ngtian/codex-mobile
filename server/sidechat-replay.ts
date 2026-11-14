import { localMediaFiles, type MediaFileReference, type MediaFileSource } from './media-file-source.js';

type Value = Record<string, any>;
export interface SidechatReplayOptions {
  files?: MediaFileSource;
  resolveReference?: (value: string) => MediaFileReference | null | Promise<MediaFileReference | null>;
  signal?: AbortSignal;
}
/** 恢复已结束的分支上下文；工具记录作为历史文字注入，不重新调用工具。 */
export async function sidechatReplayItems(turns: Value[], options: SidechatReplayOptions = {}) {
  const files = options.files ?? localMediaFiles;
  const items: Value[] = [];
  for (const turn of turns) for (const item of turn.items ?? []) {
    if (item.type === 'userMessage') {
      const content: Value[] = [];
      for (const part of item.content ?? []) {
        if (part.type === 'text') content.push({ type: 'input_text', text: part.text });
        else if (['image', 'localImage'].includes(part.type)) {
          let url = part.url ?? part.path;
          if (typeof url === 'string' && !/^(?:data:|https?:\/\/)/i.test(url)) {
            // 只使用服务端受控引用解析；上游对象的 origin/source 字段没有可信归属。
            const reference = await options.resolveReference?.(url) ?? (files.paths.isAbsolute(url) ? { source: files, path: url } : null);
            if (reference) {
              const { source, path } = reference;
              const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[source.paths.extname(path).toLowerCase()] ?? 'image/png';
              const file = await source.open(path, undefined, options.signal);
              try {
                if (file.details.type !== 'file') throw new Error('History image is not a file');
                const parts: Buffer[] = []; let length = 0;
                for await (const part of file.read()) { parts.push(part); length += part.length; }
                url = `data:${mime};base64,${Buffer.concat(parts, length).toString('base64')}`;
              } finally { await file.close(); }
            } else if (files.kind === 'remote') throw new Error('Unresolved target image reference');
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
