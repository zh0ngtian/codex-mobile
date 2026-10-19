import type { Root } from 'mdast';
import { remarkFileReferences } from '../../ui/remark-file-references';
import { parseRemoteFileHref } from '../../ui/remote-file-target';
import { prepareNativeCJKMarkdown } from '../../ui/native-markdown-display';
import { transportUuid } from '../../backends/http-transport';
import { toHast } from 'mdast-util-to-hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { messageItemText } from './message-text';
import { t } from '../../i18n';

export type QuoteRegion = 'user' | 'body' | 'commentary' | 'code' | 'table';
export interface QuoteSource {
  backendId: string; threadId: string; turnId: string; itemId: string; region: QuoteRegion; revision: string;
}
export interface MessageQuote { id: string; source: QuoteSource; text: string }
export interface SelectionQuote { source: QuoteSource; renderedText: string; start: number; end: number; text: string }
type RecordValue = Record<string, any>;
export function quoteRevision(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export function quoteSource(backendId: string, threadId: string, turnId: string, item: RecordValue): QuoteSource {
  return { backendId, threadId, turnId, itemId: String(item.id), region: item.type === 'userMessage' ? 'user' : item.phase === 'commentary' ? 'commentary' : 'body', revision: quoteRevision(messageItemText(item)) };
}
export function validateSelectionShape(value: unknown): asserts value is SelectionQuote {
  const p = value as SelectionQuote | undefined; const source = p?.source;
  if (!source || ['backendId', 'threadId', 'turnId', 'itemId', 'revision'].some(key => typeof source[key as keyof QuoteSource] !== 'string' || !source[key as keyof QuoteSource]) ||
      !['user', 'body', 'commentary', 'code', 'table'].includes(source.region) || typeof p?.renderedText !== 'string' || p.renderedText.length > 1_000_000 ||
      typeof p.text !== 'string' || !p.text.trim() || !Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end) || p.start < 0 || p.end <= p.start || p.end > p.renderedText.length ||
      p.renderedText.slice(p.start, p.end) !== p.text) throw new Error(t('选文已变化，请重新选择'));
}
// 与Web共用CommonMark/GFM。原生块用换行/列表标记，DOM textContent按节点拼接；不压平单词间的真实空白。
const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkFileReferences, { parseFileHref: parseRemoteFileHref });
function renderedContents(source: string, region: QuoteRegion, repairNative = region === 'body' || region === 'table'): string[] {
  const parsed = markdownParser.parse(source);
  const prepared = repairNative ? prepareNativeCJKMarkdown(source, parsed) : undefined;
  const tree = markdownParser.runSync(parsed) as Root;
  const nativeCandidates = prepared && prepared.markdown !== source ? renderedContents(prepared.markdown, region, false).map(prepared.restore) : [];
  const boundary = '\u0000';
  const content = (node: any, native: boolean): string => {
    if (region === 'body' && ['code', 'table'].includes(node.type)) return boundary;
    if (node.type === 'html') { const element = document.createElement('div'); element.innerHTML = node.value; return element.textContent ?? ''; }
    if (node.type === 'image' || node.type === 'imageReference') return '';
    if (node.type === 'break') return native ? '\n' : '';
    if (typeof node.value === 'string') return node.value + (node.type === 'code' && !native ? '\n' : '');
    if (node.type === 'list') return (node.children ?? []).map((child: any, index: number) => {
      const originalMarker = source.slice(child.position?.start.offset, child.position?.end.offset).match(/^\s*(\d+[.)]|[-+*])/u)?.[1];
      const marker = typeof child.checked === 'boolean' ? (child.checked ? '☑' : '☐') : node.ordered ? originalMarker ?? `${(node.start ?? 1) + index}.` : '•';
      return (native ? marker + ' ' : '') + content(child, native);
    }).join(native ? '\n' : '');
    const separator = native && ['root', 'listItem', 'blockquote', 'table'].includes(node.type) ? '\n' : native && node.type === 'tableRow' ? '\t' : '';
    return (node.children ?? []).map((child: any) => content(child, native)).join(separator);
  };
  const webText = (node: any): string => typeof node.value === 'string' ? node.value : (node.children ?? []).map(webText).join('');
  const web = webText(toHast(tree, { allowDangerousHtml: true, ...(region === 'body' ? { handlers: { code: () => ({ type: 'text' as const, value: boundary }), table: () => ({ type: 'text' as const, value: boundary }) } } : {}) }));
  if (region !== 'code' && region !== 'table') return [...[content(tree, false), content(tree, true), web].flatMap(value => value.split(boundary)), ...nativeCandidates];
  const result: string[] = [];
  const visit = (node: any) => {
    if (node.type === (region === 'code' ? 'code' : 'tableCell')) result.push(content(node, false), content(node, true));
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree); return [...result, ...nativeCandidates];
}
function matchesRenderedSnapshot(item: RecordValue, rendered: string, region: QuoteRegion) {
  const source = messageItemText(item).replace(/\r\n/g, '\n');
  const display = rendered.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  const ordinaryCommentary = item.type === 'agentMessage' && item.phase === 'commentary';
  if (item.type === 'userMessage' ? region !== 'user' : ordinaryCommentary ? region !== 'commentary' : !['body', 'code', 'table'].includes(region)) return false;
  const raw = item.type === 'userMessage' || ordinaryCommentary ? [source] : [];
  return !!display && [...raw, ...renderedContents(source, region)].some(candidate => candidate.replace(/^\n+|\n+$/g, '').includes(display));
}
function sourceRevisionMatches(revision: string, source: string) {
  if (quoteRevision(source) === revision) return true;
  // 菜单已打开时允许同一消息安全追加；替换或修改旧前缀仍拒绝，显示候选还会核对原选文是否继续存在。
  const length = Number(revision.split(':')[0]);
  return Number.isSafeInteger(length) && length > 0 && source.length > length && quoteRevision(source.slice(0, length)) === revision;
}
export function validateMessageQuote(value: unknown, backendId: string, active: RecordValue | null): MessageQuote {
  validateSelectionShape(value);
  const { source, renderedText, text } = value;
  const turn = active?.turns?.find((turn: RecordValue) => String(turn.id) === source.turnId);
  const item = turn?.items?.find((item: RecordValue) => String(item.id) === source.itemId);
  if (source.backendId !== backendId || source.threadId !== String(active?.id ?? '') || !item || !['userMessage', 'agentMessage'].includes(item.type) ||
      !sourceRevisionMatches(source.revision, messageItemText(item)) ||
      !matchesRenderedSnapshot(item, renderedText, source.region)) throw new Error(t('消息已更新，请重新选择'));
  return { id: transportUuid(), source: { ...source }, text };
}
export function quoteLabel(source: QuoteSource): string {
  return source.region === 'user' ? t('用户消息') : source.region === 'commentary' ? t('执行过程') : source.region === 'code' ? t('代码') : source.region === 'table' ? t('表格') : t('助手消息');
}
/** 可读且可恢复的引用封装。每行引用统一加前缀，因此选文本身包含“[问题]”也不会冒充问题边界。 */
export function quoteInput(question: string, quotes: readonly MessageQuote[]): string {
  if (!quotes.length) return question;
  return quotes.map((quote, index) => `[${t('引用')} ${index + 1} · ${quoteLabel(quote.source)}]\n${quote.text.split('\n').map(line => '> ' + line).join('\n')}`).join('\n\n') + `\n\n[${t('问题')}]\n${question}`;
}
export function splitQuoteInput(value: string): { question: string; referencePrefix?: string } {
  const lines = value.split('\n'); let cursor = 0; let count = 0;
  while (/^\[(?:引用|Quote) \d+ · [^\]\r\n]+\]$/u.test(lines[cursor] ?? '')) {
    cursor++; count++; const start = cursor;
    while (lines[cursor]?.startsWith('> ')) cursor++;
    if (cursor === start || lines[cursor] !== '') return { question: value };
    cursor++;
  }
  if (!count || !/^\[(?:问题|Question)\]$/u.test(lines[cursor] ?? '')) return { question: value };
  const offset = lines.slice(0, cursor + 1).join('\n').length + 1;
  return { question: value.slice(offset), referencePrefix: value.slice(0, offset) };
}
