import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../../src/app-server/client";
import { loadOlderThreadTurns, loadRunningTurnCommentary, loadTurnChangeStatsPage, resumeThreadSession } from "../../src/app-server/thread-session";
import { HttpRpcTransport } from "../../src/backends/http-transport";

let transport: HttpRpcTransport | undefined;
afterEach(async () => {
  transport?.close();
  transport = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});

describe("多项目会话打开与慢回填竞争", () => {
  it.each([{ projects: 5, perProject: 1 }, { projects: 10, perProject: 5 }])("$projects 个项目各 $perProject 个运行会话的慢回填不阻塞打开和手动分页，最终完整完成", async ({ projects, perProject }) => {
    vi.useFakeTimers();
    const count = projects * perProject;
    // 同源六条连接中预留一条给事件同步，模拟 WebKit 真正发出请求前的排队。
    let connections = 0;
    const queued: Array<() => void> = [];
    const slow = new Map<string, () => void>();
    const started: string[] = [];
    let drainSlow = false;
    const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((resolve, reject) => {
      const { message } = JSON.parse(String(init?.body));
      let active = false, settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (active) { connections--; queued.shift()?.(); }
        else { const index = queued.indexOf(start); if (index >= 0) queued.splice(index, 1); }
        if (error) { reject(error); return; }
        const turn = { id: `turn-${message.params.threadId}`, status: "inProgress", items: [] };
        const result = message.method === "thread/resume"
          ? { thread: { id: message.params.threadId, cwd: `/projects/${Math.floor(Number(message.params.threadId.slice(7)) / perProject)}` }, initialTurnsPage: { data: [turn], nextCursor: "older" } }
          : message.method === "mobile/turns/commentary" ? { turnId: turn.id, items: [] }
            : { data: [turn], nextCursor: null };
        resolve(new Response(JSON.stringify({ id: message.id, result })));
      };
      const start = () => {
        active = true; connections++;
        started.push(message.method);
        const backfill = ["mobile/turns/commentary", "mobile/turns/details"].includes(message.method);
        if (backfill && !drainSlow) slow.set(`${message.method}:${message.params.threadId}`, () => finish());
        else finish();
      };
      init?.signal?.addEventListener("abort", () => finish(init.signal!.reason), { once: true });
      if (connections < 5) start(); else queued.push(start);
    }));
    transport = new HttpRpcTransport({ id: `projects-${projects}`, baseUrl: `http://projects-${projects}.test`, token: "test" }, { fetch: fetcher });
    const client = new AppServerClient(transport);
    await vi.advanceTimersByTimeAsync(0);
    const opened: string[] = [], backfilled: string[] = [];
    const jobs: Promise<unknown>[] = [];
    for (let index = 0; index < count; index++) {
      const id = `thread-${index}`;
      jobs.push(resumeThreadSession(client, id).then(session => {
        opened.push(id);
        jobs.push(loadRunningTurnCommentary(client, id, session.thread.turns).then(() => backfilled.push(`commentary:${id}`)));
        jobs.push(loadTurnChangeStatsPage(client, id).then(() => backfilled.push(`details:${id}`)));
      }).catch(() => undefined));
      await vi.advanceTimersByTimeAsync(0);
    }
    try {
      expect(opened).toEqual(Array.from({ length: count }, (_, i) => `thread-${i}`));
      expect(started.filter(method => method === "thread/resume")).toHaveLength(count);
      expect(slow.size).toBe(4);
      let historyLoaded = false;
      jobs.push(loadOlderThreadTurns(client, `thread-${count - 1}`, "older").then(() => { historyLoaded = true; }));
      await vi.advanceTimersByTimeAsync(0);
      expect(historyLoaded).toBe(true);
      expect(backfilled).toEqual([]);
      // 两批慢读取使后续回填等待超过60秒；尚未出队的请求不能提前超时。
      await vi.advanceTimersByTimeAsync(50_000);
      [...slow.values()].forEach(finish => finish());
      await vi.advanceTimersByTimeAsync(20_000);
      expect(backfilled).toHaveLength(4);
      expect(slow.size).toBe(8);
      drainSlow = true;
      slow.forEach(finish => finish());
      await vi.advanceTimersByTimeAsync(0);
      expect(backfilled).toHaveLength(count * 2);
      expect(started.filter(method => method === "mobile/turns/commentary")).toHaveLength(count);
      expect(started.filter(method => method === "mobile/turns/details")).toHaveLength(count);
    } finally {
      transport.close();
      await Promise.allSettled(jobs);
    }
  });
});
