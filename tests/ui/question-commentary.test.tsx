import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TurnCard } from '../../src/features/conversation/Timeline';

afterEach(cleanup);

const prompt = { id: 'question', type: 'agentMessage', phase: 'final_answer', delivery: 'async',
  questions: [{ title: '显示哪种标题？', options: ['模型总结出的标题', '第一条消息原文'] }],
  text: '显示哪种标题？\n\n- 模型总结出的标题\n- 第一条消息原文', timestamp: 1792900988 };
const progress = { id: 'c', type: 'agentMessage', phase: 'commentary', text: '正在修复刷新。' };
const final = { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '已修复当前页面的标题刷新。' };

it('完成后提问和commentary共用折叠入口，展开保留问题和选项', () => {
  const { container } = render(<TurnCard client={null} turn={{ id: 'turn', status: 'completed', items: [prompt, progress, final] }} />);
  const toggle = screen.getByRole('button', { name: '之前的 2 条消息' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('显示哪种标题？')).toBeNull();
  expect(screen.getByText(final.text)).toBeVisible();
  fireEvent.click(toggle);
  expect(screen.getByText('显示哪种标题？')).toBeVisible();
  expect(screen.getByText('模型总结出的标题')).toBeVisible();
  expect(screen.getByText('第一条消息原文')).toBeVisible();
  expect(container.querySelectorAll('.previous-messages .commentary-message')).toHaveLength(2);
  fireEvent.click(toggle);
  expect(screen.queryByText('显示哪种标题？')).toBeNull();
});

it('运行中保持展开和手动折叠选择，结束后自动折叠', () => {
  const turn = { id: 'turn', status: 'inProgress', items: [prompt, progress, final] };
  const { rerender } = render(<TurnCard client={null} turn={turn} />);
  const toggle = screen.getByRole('button', { name: '之前的 2 条消息' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('显示哪种标题？')).toBeVisible();
  fireEvent.click(toggle);
  rerender(<TurnCard client={null} turn={{ ...turn, items: [prompt, progress, { ...final, text: '继续输出最终结果。' }] }} />);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  rerender(<TurnCard client={null} turn={{ ...turn, status: 'completed' }} />);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('显示哪种标题？')).toBeNull();
});
