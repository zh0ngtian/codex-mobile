import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { webCitationDisplay } from '../../src/features/conversation/web-citations';
import { MarkdownMessage } from '../../src/ui/conversation';
import { projectConversation } from '../../src/native-ui/projection';
import { quoteSource, validateMessageQuote } from '../../src/features/conversation/message-quotes';

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
it('代码、链接标签、跨段 HTML、用户示例和未解析来源保持原文', () => {
  for (const text of [`\`${cite}\``, `\`\`\`text\n${cite}\n\`\`\``, `[${cite}](https://example.com)`, `<span>\n\n${cite}\n\n</span>`, `\\${cite}`]) {
    expect(webCitationDisplay(text, sources)).toBe(text);
  }
  expect(webCitationDisplay(cite, [])).toBe(cite);
  expect(webCitationDisplay(cite, [{ ...sources[0], url: 'javascript:alert(1)' }, sources[1]])).toBe(cite);
  expect(webCitationDisplay(cite, [...sources, { ...sources[0], url: 'https://example.com/other' }])).toBe(cite);
  expect(webCitationDisplay('citeturn480194view0', sources)).toBe('citeturn480194view0');
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
