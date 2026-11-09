import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { nativeDisplayTextRanges } from '../../ui/remark-file-references';
import { webCitationPattern, webCitationURL } from '../../../server/web-citation-format';

const parser = unified().use(remarkParse).use(remarkGfm);
/** 每条回答按首次出现的来源编号；重复引用沿用编号，原始消息仍用于复制与身份校验。 */
export function webCitationDisplay(raw: string, sources: unknown): string {
  if (!raw.includes('\uE200cite\uE202') || !Array.isArray(sources)) return raw;
  const known = new Map<string, string | null>();
  for (const source of sources) {
    if (!source || typeof source.refId !== 'string') continue;
    const url = webCitationURL(source.url);
    if (!url) continue;
    known.set(source.refId, known.has(source.refId) && known.get(source.refId) !== url ? null : url);
  }
  const numbers = new Map<string, number>();
  const edits: { start: number; end: number; text: string }[] = [];
  for (const range of nativeDisplayTextRanges(parser.parse(raw))) {
    const value = raw.slice(range.start, range.end);
    for (const match of value.matchAll(webCitationPattern())) {
      const start = range.start + match.index!;
      let backslashes = 0;
      for (let cursor = start - 1; cursor >= 0 && raw[cursor] === '\\'; cursor--) backslashes++;
      if (backslashes % 2) continue;
      const ids = [...new Set(match[1].split('\uE202'))];
      if (ids.some(id => !known.get(id))) continue;
      const text = ids.map(id => {
        const url = known.get(id)!;
        if (!numbers.has(url)) numbers.set(url, numbers.size + 1);
        return `[\\[${numbers.get(url)}\\]](<${url}>)`;
      }).join(' ');
      edits.push({ start, end: start + match[0].length, text });
    }
  }
  let result = raw;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
