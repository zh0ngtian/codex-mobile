import type { Root } from 'mdast';
import { nativeDisplayTextRanges } from './remark-file-references';

/** 对齐NativeMarkdownDisplaySource.needsCJKClosingBoundary；仍由同一Markdown解析器负责配对和嵌套，恢复时不增删正文。 */
export function prepareNativeCJKMarkdown(source: string, parsed: Root) {
  const ranges = nativeDisplayTextRanges(parsed);
  let prefix = 'CodexNativeClosingBoundary';
  while (source.includes(prefix)) prefix += 'Q';
  const replacements: Array<[string, string]> = [];
  let markdown = ''; let offset = 0;
  for (const character of source) {
    const next = offset + character.length;
    if (!'*_`\\'.includes(character) && /^\p{P}$/u.test(character) && source.slice(next, next + 2) === '**' && ranges.some(range => offset >= range.start && offset < range.end)) {
      let end = next + 2;
      while (source[end] === '*') end++;
      const point = source.codePointAt(end) ?? 0;
      const cjk = (point >= 0x3400 && point <= 0x9fff) || (point >= 0x20000 && point <= 0x3134f) || (point >= 0x3040 && point <= 0x30ff) || (point >= 0xac00 && point <= 0xd7af);
      let escapes = 0;
      for (let index = offset - 1; index >= 0 && source[index] === '\\'; index--) escapes++;
      if (cjk && escapes % 2 === 0) {
        const marker = `${prefix}${replacements.length}End`;
        replacements.push([marker, character]); markdown += marker;
      } else markdown += character;
    } else markdown += character;
    offset = next;
  }
  return { markdown, restore: (value: string) => replacements.reduce((result, [marker, character]) => result.split(marker).join(character), value) };
}
