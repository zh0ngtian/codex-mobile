// @vitest-environment node
import { expect, it } from 'vitest';
import { RemoteStream } from '../../server/remote/relay.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { DESKTOP_PINNED_SECTION_ID as PIN, readDesktopPinnedThreads, setDesktopThreadPinned } from '../../server/desktop-thread-pins.js';
it('直接注入各目标ready RPC，固定分组完整分页、move后readback，caller保持可用', async () => {
  const make = async (target: string) => {
    const frames: any[] = []; let pinned = false; let sequence = 0;
    const stream = new RemoteStream(target, 'pin-' + target, async (_s, raw) => {
      if (!raw) return { seqId: 0 }; const frame = JSON.parse(JSON.stringify(raw)); frames.push(frame); const p = frame.params ?? {};
      let result: any = 42;
      if (frame.method === 'initialize') result = { codexHome: '/same/path' };
      if (frame.method === 'threadSection/list') result = { data: [{ id: PIN, name: target }], nextCursor: null };
      if (frame.method === 'thread/list') result = p.cursor ? { data: [{ id: target + '-two', section: { id: PIN } }, { id: 'archive', archived: true, section: { id: PIN } }], nextCursor: null } : { data: [{ id: target + '-one', section: { id: PIN } }, { id: 'hidden', threadSource: 'subagent', section: { id: PIN } }], nextCursor: 'second' };
      if (frame.method === 'thread/read') result = { thread: { id: target, section: pinned ? { id: PIN } : null } };
      if (frame.method === 'thread/section/move') { pinned = p.sectionId === PIN; result = {}; }
      if (frame.id) queueMicrotask(() => stream.emit('message', { id: frame.id, result }, { seqId: ++sequence }));
      return { seqId: sequence };
    }, () => {});
    const session = RemoteRpcSession.fromRemoteStream(stream); await session.initialize(); return { session, frames };
  };
  const a = await make('A'); const b = await make('B');
  try {
    for (const [id, f] of [['A', a], ['B', b]] as const) {
      const request = (method: string, params: any) => f.session.call(method, params);
      expect((await readDesktopPinnedThreads(request)).map(x => x.id)).toEqual([id + '-one', id + '-two']);
      expect(await setDesktopThreadPinned(request, id, true)).toMatchObject({ id, section: { id: PIN } });
      expect(f.frames.slice(-3).map(x => x.method)).toEqual(['thread/read', 'thread/section/move', 'thread/read']);
      expect(await f.session.call('alive')).toBe(42);
    }
  } finally { a.session.close(); b.session.close(); }
});
