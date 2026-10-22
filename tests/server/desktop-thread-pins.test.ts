import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_PINNED_SECTION_ID as PIN, readDesktopPinnedThreads, setDesktopThreadPinned } from '../../server/desktop-thread-pins.js';

describe('桌面置顶分组协议', () => {
  it('按固定身份发现改名后的置顶分组，完整分页并过滤隐藏和归档会话', async () => {
    const request = vi.fn(async (method: string, params: any): Promise<any> => {
      if (method === 'threadSection/list') return params.cursor ? { data: [{ id: PIN, name: '我的收藏' }], nextCursor: null } : { data: [{ id: 'custom', name: 'Pinned' }], nextCursor: 'sections-2' };
      return params.cursor ? { data: [{ id: 'two', section: { id: PIN } }, { id: 'archived', section: { id: PIN }, archived: true }], nextCursor: null } : { data: [{ id: 'one', section: { id: PIN } }, { id: 'child', section: { id: PIN }, threadSource: 'subagent' }], nextCursor: 'threads-2' };
    });
    expect((await readDesktopPinnedThreads(request)).map(t => t.id)).toEqual(['one', 'two']);
    expect(request.mock.calls.filter(([m]) => m === 'thread/list').every(([, p]) => p.sectionId === PIN && p.sortKey === 'section_position' && p.archived === false)).toBe(true);
    expect(request.mock.calls.every(([m]) => !['thread/metadata/update', 'thread/section/move'].includes(m))).toBe(true);
  });
  it.each(['unavailable', 'missing', 'loop', 'invalid'])('分组读取%s时报告错误，不静默当空集合', async mode => {
    const request = vi.fn(async (): Promise<any> => {
      if (mode === 'unavailable') throw new Error('method not found');
      if (mode === 'missing') return { data: [], nextCursor: null };
      if (mode === 'loop') return { data: [], nextCursor: 'repeat' };
      return {};
    });
    await expect(readDesktopPinnedThreads(request)).rejects.toThrow(mode === 'unavailable' ? '升级' : undefined);
  });
  it('只移动到真实置顶分组，成功后回读验证', async () => {
    let section: string | null = 'custom';
    const request = vi.fn(async (method: string, params: any): Promise<any> => {
      if (method === 'thread/read') return { thread: { id: 'one', section: section ? { id: section } : null } };
      section = params.sectionId; return {};
    });
    await expect(setDesktopThreadPinned(request, 'one', true)).resolves.toMatchObject({ id: 'one', section: { id: PIN } });
    expect(request).toHaveBeenCalledWith('thread/section/move', { threadId: 'one', sectionId: PIN, beforeThreadId: null });
    await expect(setDesktopThreadPinned(request, 'one', false)).resolves.toMatchObject({ id: 'one', section: null });
  });
  it('取消已经不在置顶区的会话不会清除桌面其他自定义分组', async () => {
    const request = vi.fn(async (): Promise<any> => ({ thread: { id: 'one', section: { id: 'custom' } } }));
    await expect(setDesktopThreadPinned(request, 'one', false)).resolves.toMatchObject({ section: { id: 'custom' } });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('写入失败、ID不匹配或回读未改变都不报告成功', async () => {
    for (const mode of ['failure', 'mismatch', 'unchanged']) {
      const request = vi.fn(async (method: string): Promise<any> => {
        if (method === 'thread/section/move' && mode === 'failure') throw new Error('offline');
        return { thread: { id: mode === 'mismatch' ? 'other' : 'one', section: null } };
      });
      await expect(setDesktopThreadPinned(request, 'one', true)).rejects.toThrow();
    }
  });
});
