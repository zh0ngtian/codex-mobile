import { isVisibleThread } from './thread-visibility.js';

// Codex Desktop 0.163.0-alpha.11 的保留分组身份；用户重命名不改变此 ID。
export const DESKTOP_PINNED_SECTION_ID = '01984de2-8f74-7c91-a3b2-5c5e937cf318';
type Thread = Record<string, any>;
export type DesktopPinRequest = (method: string, params: Record<string, unknown>) => Promise<any>;

function nextCursor(page: any, visited: Set<string>) {
  if (!Array.isArray(page?.data)) throw new Error('桌面置顶列表返回无效，请重试');
  const next = page.nextCursor;
  if (next == null) return null;
  if (typeof next !== 'string' || !next || visited.has(next)) throw new Error('桌面置顶列表游标无效，请重试');
  visited.add(next);
  return next;
}

/** 浏览器与网关共享同一份协议，失败时不回退到旧本地关注或 isPinned。 */
export async function readDesktopPinnedThreads(request: DesktopPinRequest): Promise<Thread[]> {
  let cursor: string | null = null;
  const sections = new Set<string>();
  let found = false;
  do {
    let page: any;
    try { page = await request('threadSection/list', { limit: 100, cursor }); }
    catch (error) {
      if ((error as any)?.code === -32601 || /method not found|unknown method|unknown variant [`'"]?threadSection\/list/i.test(error instanceof Error ? error.message : '')) {
        throw new Error('当前 Codex app-server 不支持桌面置顶同步，请升级后重试', { cause: error });
      }
      throw error;
    }
    cursor = nextCursor(page, sections);
    found = page.data.some((section: any) => section?.id === DESKTOP_PINNED_SECTION_ID);
  } while (!found && cursor);
  if (!found) throw new Error('当前 Codex app-server 未提供桌面置顶分组，请升级后重试');
  const threads = new Map<string, Thread>();
  const pages = new Set<string>();
  cursor = null;
  do {
    const page = await request('thread/list', { limit: 100, cursor, archived: false, modelProviders: [],
      sectionId: DESKTOP_PINNED_SECTION_ID, sortKey: 'section_position', useStateDbOnly: true });
    cursor = nextCursor(page, pages);
    for (const thread of page.data) {
      if (typeof thread?.id !== 'string' || !thread.id || thread.section?.id !== DESKTOP_PINNED_SECTION_ID) {
        throw new Error('桌面置顶会话返回无效，请重试');
      }
      if (thread.archived === true || !isVisibleThread(thread)) continue;
      const { turns: _turns, ...metadata } = thread;
      threads.set(thread.id, metadata);
    }
  } while (cursor);
  return [...threads.values()];
}

export async function setDesktopThreadPinned(request: DesktopPinRequest, threadId: string, pinned: boolean): Promise<Thread> {
  const read = async () => {
    const result = await request('thread/read', { threadId, includeTurns: false });
    if (result?.thread?.id !== threadId || !Object.hasOwn(result.thread, 'section')) throw new Error('桌面置顶状态返回无效，请重试');
    return result.thread as Thread;
  };
  const current = await read();
  if ((current.section?.id === DESKTOP_PINNED_SECTION_ID) === pinned) return current;
  await request('thread/section/move', { threadId, sectionId: pinned ? DESKTOP_PINNED_SECTION_ID : null, beforeThreadId: null });
  const thread = await read();
  if ((thread.section?.id === DESKTOP_PINNED_SECTION_ID) !== pinned) throw new Error('桌面置顶状态已变化，请刷新重试');
  return thread;
}
