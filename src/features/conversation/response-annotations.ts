import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { MessageReference } from '../../../server/user-message-format';

const parser = unified().use(remarkParse);
/** 只转换普通正文中的有效引用标记，代码和无对应引用的标记始终保留。 */
export function responseAnnotationDisplay(raw: string, references: readonly MessageReference[], label = '引用'): string {
  if (!references.length || !raw.includes('codex-annotation')) return raw;
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: any, protectedNode = false) => {
    const blocked = protectedNode || ['link', 'linkReference', 'code', 'inlineCode', 'html'].includes(node.type);
    if (!blocked && node.type === 'text' && node.position) {
      const start = node.position.start.offset;
      const value = raw.slice(start, node.position.end.offset);
      for (const match of value.matchAll(/(?<!:):{1,2}codex-annotation\{index="([1-9]\d*)"\}/g)) {
        if (Number(match[1]) > references.length) continue;
        edits.push({ start: start + match.index!, end: start + match.index! + match[0].length, text: `[${label} ${match[1]}](#codex-annotation-${match[1]})` });
      }
    }
    if (!blocked) for (const child of node.children ?? []) visit(child, blocked);
  };
  visit(parser.parse(raw));
  let result = raw;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
