import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { webCitationDisplay } from '../../src/features/conversation/web-citations';
import { MarkdownMessage } from '../../src/ui/conversation';
import { projectConversation } from '../../src/native-ui/projection';
import { quoteSource, validateMessageQuote } from '../../src/features/conversation/message-quotes';

afterEach(cleanup);

const sources = [
  { refId: 'turn480194view0', url: 'https://example.com/guide' },
  { refId: 'turn480194view1', url: 'https://example.com/code?q=(test)' },
];
const cite = 'citeturn480194view0turn480194view1';
const raw = `**当前版本没有内置锁定模块。**这是状态确认开关。${cite}\n\n保留现有接管配置。citeturn480194view0`;
it('双来源变为可点击编号，重复来源沿用编号，正文和中文强调保留', () => {
  const display = webCitationDisplay(raw, sources);
  render(<MarkdownMessage text={display} />);
  expect(screen.getAllByRole('link', { name: '[1]' })).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: '[1]' })[0]).toHaveAttribute('href', sources[0].url);
  expect(screen.getByRole('link', { name: '[2]' })).toHaveAttribute('href', 'https://example.com/code?q=%28test%29');
  expect(display).toContain('**当前版本没有内置锁定模块。**');
  expect(display).not.toContain('turn480194');
});
it('代码、链接标签、跨段 HTML、转义示例和未完成标记保持原文', () => {
  for (const text of [`\`${cite}\``, `\`\`\`text\n${cite}\n\`\`\``, `[${cite}](https://example.com)`, `<span>\n\n${cite}\n\n</span>`, `\\${cite}`]) {
    expect(webCitationDisplay(text, sources)).toBe(text);
    expect(webCitationDisplay(text, undefined)).toBe(text);
  }
  expect(webCitationDisplay('citeturn480194view0', sources)).toBe('citeturn480194view0');
});
it.each([undefined, null, {}, []].map(unavailable => ({ unavailable })))('没有可恢复来源时隐藏引用标记，不显示占位文字 $unavailable', ({ unavailable }) => {
  const text = `前文。${cite}\n\n**后文。**`;
  const display = webCitationDisplay(text, unavailable);
  expect(display).toBe('前文。\n\n**后文。**');
  render(<MarkdownMessage text={display} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText('后文。').tagName).toBe('STRONG');
});
it.each([
  [sources[1]],
  [{ ...sources[0], url: 'javascript:alert(1)' }, sources[1]],
  [...sources, { ...sources[0], url: 'https://example.com/other' }],
].map(available => ({ available })))('混合引用仅显示可恢复的来源，编号连续且重复沿用 $available', ({ available }) => {
  const text = `前文。citeturn480194view0\n\n中段。${cite}后文。citeturn480194view1`;
  const display = webCitationDisplay(text, available);
  render(<MarkdownMessage text={display} />);
  expect(display).not.toContain('cite');
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link).toHaveTextContent('[1]');
    expect(link).toHaveAttribute('href', 'https://example.com/code?q=%28test%29');
  }
});
it('原生投影隐藏缺失引用后保留原文，并按可见正文验证选文', () => {
  const text = `前文。${cite}后文。`;
  const item = { id: 'answer', type: 'agentMessage', phase: 'final_answer', text };
  const active = { id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [item] }] };
  const messages = projectConversation(active, path => path, undefined, undefined, 'backend');
  const answer = messages.find(message => message.role === 'assistant');
  expect(answer?.text).toBe('前文。后文。');
  expect(answer?.rawText).toBe(text);
  const selection = { source: quoteSource('backend', 'thread', 'turn', item), renderedText: '前文。后文。', text: '后文。', start: 3, end: 6 };
  expect(validateMessageQuote(selection, 'backend', active).text).toBe('后文。');
});
it('原生投影和网页采用相同编号，复制保留原文，选择编号后的正文仍可引用', () => {
  const item = { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: raw, webCitations: sources };
  const active = { id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [item] }] };
  const messages = projectConversation(active, path => path, undefined, undefined, 'backend');
  expect(messages.find(message => message.role === 'assistant')?.text).toBe(webCitationDisplay(raw, sources));
  expect(messages.find(message => message.role === 'assistant')?.rawText).toBe(raw);
  const renderedText = '当前版本没有内置锁定模块。这是状态确认开关。[1] [2]';
  const selection = { source: quoteSource('backend', 'thread', 'turn', item), renderedText, text: '[1] [2]', start: renderedText.length - 7, end: renderedText.length };
  expect(validateMessageQuote(selection, 'backend', active).text).toBe('[1] [2]');
  const users = projectConversation({ id: 'thread', turns: [{ id: 'turn', items: [{ ...item, type: 'userMessage', content: [{ type: 'text', text: raw }] }] }] }, path => path);
  expect(users[0].text).toContain(cite);
});
