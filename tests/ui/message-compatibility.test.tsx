import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { encodeUserMessage } from '../../server/user-message-format';
import { TurnCard } from '../../src/features/conversation/Timeline';
afterEach(cleanup);
it('网页隐藏新消息包装、显示文件卡片，并从回复标记展开对应引用', () => {
 const raw = encodeUserMessage('用户问题', [{ name: '中文 文档.txt', path: '/tmp/中文 文档.txt' }], [{ text: '引用原文', annotation: '请解释' }]);
 const { container } = render(<TurnCard client={null} turn={{ id: 'turn', status: 'completed', items: [
  { id: 'user', type: 'userMessage', content: [{ type: 'text', text: raw }] },
  { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '回答 :codex-annotation{index="1"}' },
 ] }} />);
 expect(screen.getByText('用户问题')).toBeVisible();
 expect(screen.getByRole('link', { name: '中文 文档.txt' }).getAttribute('href')).toBe('/tmp/%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.txt');
 expect(container.textContent).not.toContain('Files mentioned by the user');
 expect(container.textContent).not.toContain('response-annotations');
 const card = container.querySelector<HTMLDetailsElement>('.assistant-message details')!;
 card.scrollIntoView = vi.fn();
 expect(card.open).toBe(false);
 fireEvent.click(screen.getByRole('link', { name: '引用 1' }));
 expect(card.open).toBe(true);
 expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
 expect(card.textContent).toContain('引用原文');
 expect(card.textContent).toContain('请解释');
});
it('网页多段用户文本保留分隔，不把正文和下一段粘连', () => {
 const { container } = render(<TurnCard client={null} turn={{ id: 'turn', status: 'completed', items: [{ id: 'user', type: 'userMessage', content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] }] }} />);
 expect(container.querySelector('.user-markdown')?.textContent).toBe('第一段\n第二段');
});
