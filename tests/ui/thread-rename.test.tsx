import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadRename } from '../../src/ui/thread-rename';
import { summarizeThreadTitle, TitleSummaryUnavailableError } from '../../src/backends/title-summary';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const backend = { id: 'a', baseUrl: 'https://gateway.invalid', token: 'secret', name: '网关', hostId: 'a', enabled: true, order: 0 };
it.each([404, 405, 501])('旧网关 %s 明确标识接口缺失', async status => {
  await expect(summarizeThreadTitle(backend, 't', vi.fn(async () => new Response('', { status })))).rejects.toBeInstanceOf(TitleSummaryUnavailableError);
});
it('模型总结期间保持弹窗与加载状态，返回仅填入输入框，编辑后保存', async () => {
  let done!: (response: Response) => void;
  const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { done = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const saved = vi.fn();
  function Host() { const rename = useThreadRename(); return <><button onClick={async () => saved(await rename.request(backend, 't', '原标题'))}>重命名</button>{rename.dialog}</>; }
  render(<Host />);
  fireEvent.click(screen.getByText('重命名'));
  fireEvent.click(screen.getByText('模型总结'));
  expect(screen.getByRole('button', { name: /模型总结/ })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  expect(saved).not.toHaveBeenCalled();
  await act(async () => done(new Response(JSON.stringify({ title: '模型候选标题' }))));
  const field = screen.getByRole('textbox', { name: '会话名称' });
  expect(field).toHaveValue('模型候选标题'); expect(saved).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '我修改的标题' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('我修改的标题'));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain('token=secret');
});
it('手动总结遇旧网关在弹窗内提示升级，保留输入并能继续手动保存', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  const saved = vi.fn();
  function Host() { const rename = useThreadRename(); return <><button onClick={async () => saved(await rename.request(backend, 't', '原标题'))}>重命名</button>{rename.dialog}</>; }
  render(<Host />); fireEvent.click(screen.getByText('重命名'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '手工标题' } });
  fireEvent.click(screen.getByText('模型总结'));
  expect(await screen.findByRole('alert')).toHaveTextContent('请升级网关服务器');
  expect(screen.getByRole('textbox')).toHaveValue('手工标题');
  fireEvent.click(screen.getByText('保存'));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('手工标题'));
});
it('取消后迟到的模型结果不会填入下一次重命名', async () => {
  let done!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { done = resolve; })));
  function Host() { const rename = useThreadRename(); return <><button onClick={() => void rename.request(backend, 't', '原标题')}>重命名</button>{rename.dialog}</>; }
  render(<Host />); fireEvent.click(screen.getByText('重命名')); fireEvent.click(screen.getByText('模型总结')); fireEvent.click(screen.getByText('取消'));
  fireEvent.click(screen.getByText('重命名'));
  await act(async () => done(new Response('{"title":"过期结果"}')));
  expect(screen.getByRole('textbox')).toHaveValue('原标题');
});
