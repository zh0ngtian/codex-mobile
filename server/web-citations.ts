import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { messageRolloutFiles } from './message-rollout-files.js';
import { WEB_REFERENCE, webCitationIds, webCitationURL, type WebCitation } from './web-citation-format.js';

type RecordValue = Record<string, any>;
type Cached = { signature: string; checked: Set<string>; sources: Map<string, WebCitation | null> };

function* outputTexts(output: unknown, depth = 0): Generator<string> {
  if (depth > 8) return;
  if (typeof output === 'string') {
    // MCP 输出既可以直接返回文本，也可以把 content 数组序列化成 JSON。
    if (/^\s*[\[{]/.test(output)) {
      try { yield* outputTexts(JSON.parse(output), depth + 1); return; } catch { /* 普通文本继续按工具输出读取。 */ }
    }
    yield output;
  } else if (Array.isArray(output)) {
    for (const part of output) yield* outputTexts(part, depth + 1);
  } else if (output && typeof output === 'object') {
    const part = output as RecordValue;
    if (typeof part.text === 'string') yield* outputTexts(part.text, depth + 1);
    else if (Array.isArray(part.content)) yield* outputTexts(part.content, depth + 1);
    // 并行工具调用会把成功结果包在 JSON 文本的 settled value 中。
    else if (part.status === 'fulfilled') yield* outputTexts(part.value, depth + 1);
  }
}

/** 仅从本会话工具输出的来源标题提取 HTTP(S) 地址；不改写 rollout，不缓存工具正文。 */
export class MessageWebCitations {
  private cache = new Map<string, Cached>();
  constructor(private codexHome: string) {}

  async read(threadId: string, ids: string[]): Promise<WebCitation[]> {
    const wanted = [...new Set(ids.filter(id => new RegExp(`^${WEB_REFERENCE}$`).test(id)))].slice(0, 2048);
    if (!wanted.length) return [];
    const sources = new Map<string, WebCitation | null>();
    for await (const path of messageRolloutFiles(this.codexHome, threadId)) {
      const values = await this.readFile(path, threadId, wanted);
      for (const [id, value] of values) {
        const prior = sources.get(id);
        sources.set(id, sources.has(id) && prior?.url !== value?.url ? null : value);
      }
    }
    return wanted.flatMap(id => sources.get(id) ? [sources.get(id)!] : []);
  }

  private async readFile(path: string, threadId: string, wanted: string[]): Promise<Map<string, WebCitation | null>> {
    try {
      const file = await stat(path);
      const signature = `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
      const previous = this.cache.get(path);
      if (previous?.signature === signature && wanted.every(id => previous.checked.has(id))) {
        return new Map(wanted.filter(id => previous.sources.has(id)).map(id => [id, previous.sources.get(id)!]));
      }
      const ids = new Set(wanted);
      const sources = new Map<string, WebCitation | null>();
      const stream = createReadStream(path);
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let first = true;
      try {
        for await (const line of lines) {
          let entry: RecordValue;
          try { entry = JSON.parse(line); } catch { if (first) return new Map(); else continue; }
          if (first) {
            first = false;
            if (entry.type !== 'session_meta' || entry.payload?.id !== threadId) return new Map();
            continue;
          }
          const item = entry.payload;
          if (entry.type !== 'response_item' || !['custom_tool_call_output', 'function_call_output'].includes(item?.type)) continue;
          for (const text of outputTexts(item.output)) {
            const header = new RegExp(`^(.{1,1000}) \\((https?:\\/\\/[^\\s]{1,8192})\\)\\r?\\n【(${WEB_REFERENCE})】(?=\\s)`, 'gm');
            for (const match of text.matchAll(header)) {
              const id = match[3];
              if (!ids.has(id)) continue;
              const url = webCitationURL(match[2]);
              if (!url) continue;
              const value = { refId: id, url, title: match[1].slice(0, 512) };
              sources.set(id, sources.has(id) && sources.get(id)?.url !== url ? null : value);
            }
          }
        }
      } finally { lines.close(); stream.destroy(); }
      this.cache.delete(path);
      this.cache.set(path, { signature, checked: ids, sources });
      while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      return sources;
    } catch { return new Map(); }
  }

  async result(threadId: string, result: RecordValue): Promise<RecordValue> {
    if (!result || typeof result !== 'object') return result;
    const items: RecordValue[] = [];
    const collect = (node: RecordValue) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'agentMessage' && typeof node.text === 'string') items.push(node);
      for (const field of ['data', 'items', 'turns']) if (Array.isArray(node[field])) for (const child of node[field]) collect(child);
      for (const field of ['thread', 'turn', 'initialTurnsPage']) if (node[field]) collect(node[field]);
    };
    collect(result);
    const sources = await this.read(threadId, items.flatMap(item => webCitationIds(item.text)));
    if (!sources.length) return result;
    const known = new Map(sources.map(source => [source.refId, source]));
    const project = (node: RecordValue): RecordValue => {
      if (!node || typeof node !== 'object') return node;
      const value = { ...node };
      if (node.type === 'agentMessage' && typeof node.text === 'string') {
        const citations = webCitationIds(node.text).flatMap(id => known.has(id) ? [known.get(id)!] : []);
        if (citations.length) value.webCitations = citations;
      }
      for (const field of ['data', 'items', 'turns']) if (Array.isArray(node[field])) value[field] = node[field].map(project);
      for (const field of ['thread', 'turn', 'initialTurnsPage']) if (node[field]) value[field] = project(node[field]);
      return value;
    };
    return project(result);
  }

  async notification<T extends RecordValue>(message: T): Promise<T> {
    const item = message.params?.item;
    if (message.method !== 'item/completed' || item?.type !== 'agentMessage' || typeof message.params?.threadId !== 'string') return message;
    const result = await this.result(message.params.threadId, { items: [item] });
    return result.items[0] === item ? message : { ...message, params: { ...message.params, item: result.items[0] } };
  }
}
