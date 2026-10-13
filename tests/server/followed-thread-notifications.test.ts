import { describe, expect, it } from "vitest";

const success = (id: string) => ({ id, status: "completed", items: [{ type: "agentMessage", phase: "final_answer" }] });
async function fixture() {
  const path = "../../server/followed-thread-notifications.js";
  const module = await import(path).catch(() => null);
  expect(module, "后台关注观察器尚未实现").not.toBeNull();
  const followed = new Set(["a"]), requests: any[] = [], notifications: any[] = [], returnedPages: any[][] = [];
  let turns: any[] = [success("old")]; let failure = false; let hidden = false;
  let deferred: (() => Promise<void>) | undefined;
  const observer = new module!.FollowedThreadNotifications({
    followedThreadIds: () => followed,
    notifyCompletion: (threadId: string, turnId: string) => notifications.push([threadId, turnId]),
    sessions: { hostedRpc: async (message: any) => {
      requests.push(message); if (deferred) await deferred(); if (failure) throw new Error("offline");
      if (message.method === "thread/read") return { result: { thread: { id: "a", ...(hidden ? { threadSource: "subagent" } : {}) } } };
      const offset = Number(message.params.cursor ?? "0");
      const limit = message.params.limit;
      const data = turns.slice(offset, offset + limit); returnedPages.push(data);
      return { result: { data, nextCursor: offset + limit < turns.length ? String(offset + limit) : null } };
    } }, pollIntervalMs: 5,
  });
  return { observer, followed, requests, notifications, returnedPages, turns: (value: any[]) => { turns = value; }, fail: (value: boolean) => { failure = value; }, hide: () => { hidden = true; }, defer: (value?: () => Promise<void>) => { deferred = value; } };
}
describe("后台关注会话只读通知", () => {
  it("历史完成为基线，首次运行回合之后完成通知，失败与无 final 静默", async () => {
    const f = await fixture(); f.turns([{ id: "running", status: "inProgress", items: [] }, success("old")]);
    await f.observer.poll(); expect(f.notifications).toEqual([]);
    f.turns([success("running"), success("old")]); await f.observer.poll(); expect(f.notifications).toEqual([["a", "running"]]);
    f.turns([{ ...success("bad"), status: "failed" }, { ...success("no-final"), items: [{ type: "agentMessage" }] }, success("running"), success("old")]);
    await f.observer.poll(); expect(f.notifications).toHaveLength(1);
    expect(f.requests.every(request => ["thread/read", "thread/turns/list"].includes(request.method))).toBe(true);
    expect(f.requests.filter(request => request.method === "thread/read").every(request => request.params.includeTurns === false)).toBe(true);
    await f.observer.close();
  });
  it("多个新回合跨页追到基线，重复与重启不补发历史", async () => {
    const f = await fixture(); await f.observer.poll(); f.turns([success("four"), success("three"), success("two"), success("old")]);
    const before = f.requests.length;
    await f.observer.poll(); expect(f.notifications).toEqual([["a", "two"], ["a", "three"], ["a", "four"]]);
    expect(f.requests.slice(before).filter(request => request.method === "thread/turns/list").map(request => request.params.cursor ?? null)).toEqual([null, "1", "2", "3"]);
    await f.observer.poll(); expect(f.notifications).toHaveLength(3); await f.observer.close();
    const restart = await fixture(); restart.turns([success("four"), success("three")]); await restart.observer.poll(); expect(restart.notifications).toEqual([]); await restart.observer.close();
  });
  it("读取失败重试且不移动基线，隐藏来源静默，取消与关闭清理请求", async () => {
    const f = await fixture(); await f.observer.poll(); f.turns([success("next"), success("old")]); f.fail(true);
    await f.observer.poll(); expect(f.notifications).toEqual([]); f.fail(false); await f.observer.poll(); expect(f.notifications).toEqual([["a", "next"]]);
    f.hide(); f.turns([success("child"), success("next")]); await f.observer.poll(); expect(f.notifications).toHaveLength(1);
    f.followed.clear(); const count = f.requests.length; await f.observer.poll(); expect(f.requests).toHaveLength(count);
    await f.observer.close(); f.followed.add("a"); await f.observer.poll(); expect(f.requests).toHaveLength(count);
  });
  it("并行 poll 不重叠，取消中的请求结束后不得继续读取或推送", async () => {
    const f = await fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.defer(() => gate);
    const first = f.observer.poll(); const second = f.observer.poll(); expect(f.requests).toHaveLength(1);
    f.followed.clear(); release(); await Promise.all([first, second]); expect(f.requests).toHaveLength(1); expect(f.notifications).toEqual([]);
    await f.observer.close();
  });
});

it("新完成回合的 final 证据迟到后仍通知，首次完成历史始终静默", async () => {
  const f = await fixture(); await f.observer.poll();
  f.turns([{ ...success("late"), items: [] }, success("old")]); await f.observer.poll(); expect(f.notifications).toEqual([]);
  f.turns([success("late"), success("old")]); await f.observer.poll(); expect(f.notifications).toEqual([["a", "late"]]);
  await f.observer.close();
});

it("关闭不等待失联 RPC，取消后立即重新关注不会复用旧轮询", async () => {
  const f = await fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.defer(() => gate);
  const poll = f.observer.poll();
  f.followed.clear(); const canceled = f.observer.poll(); f.followed.add("a"); release(); await Promise.all([poll, canceled]);
  expect(f.requests).toHaveLength(1);
  let releaseAgain!: () => void; const anotherGate = new Promise<void>(resolve => { releaseAgain = resolve; }); f.defer(() => anotherGate);
  const pending = f.observer.poll();
  const closed = await Promise.race([f.observer.close().then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 30))]);
  releaseAgain(); await pending; expect(closed).toBe(true); expect(f.notifications).toEqual([]);
});

it("正常定期轮询只读取最新单回合，旧历史的大工具正文不反复加载", async () => {
  const f = await fixture();
  f.turns([success("latest"), ...Array.from({ length: 50 }, (_, index) => ({
    ...success(`historical-${index}`), items: [{ type: "commandExecution", output: "tool-output".repeat(10000) }],
  }))]);
  await f.observer.poll(); await f.observer.poll(); await f.observer.poll();
  const lists = f.requests.filter(request => request.method === "thread/turns/list");
  expect(lists).toHaveLength(3);
  expect(lists.every(request => request.params.limit === 1 && request.params.cursor === undefined)).toBe(true);
  expect(f.returnedPages.map(page => page.map(turn => turn.id))).toEqual([["latest"], ["latest"], ["latest"]]);
  expect(JSON.stringify(f.returnedPages)).not.toContain("tool-output");
  expect(f.notifications).toEqual([]); await f.observer.close();
});

it("无 final 的旧成功回合出现后续回合后不再导致每轮扫描旧历史", async () => {
  const f = await fixture(); await f.observer.poll();
  const noFinal = { ...success("no-final"), items: [] };
  f.turns([noFinal, success("old")]); await f.observer.poll(); expect(f.notifications).toEqual([]);
  const later = Array.from({ length: 20 }, (_, n) => success(`later-${20 - n}`));
  f.turns([...later, noFinal, success("old")]); await f.observer.poll();
  expect(f.notifications).toHaveLength(20);
  f.requests.length = 0; f.returnedPages.length = 0;
  await f.observer.poll(); await f.observer.poll();
  expect(f.requests.filter(request => request.method === "thread/turns/list")).toHaveLength(2);
  expect(f.returnedPages.map(page => page.map(turn => turn.id))).toEqual([["later-20"], ["later-20"]]);
  await f.observer.close();
});

it.each([true, false])("新回合超过待确认旧回合时先读取一次，旧 final 已到达=%s", async hasLateFinal => {
  const f = await fixture(); await f.observer.poll();
  f.turns([{ ...success("late"), items: [] }, success("old")]); await f.observer.poll();
  f.requests.length = 0;
  f.turns([success("next"), { ...success("late"), items: hasLateFinal ? success("late").items : [] }, success("old")]);
  await f.observer.poll();
  expect(f.notifications).toEqual(hasLateFinal ? [["a", "late"], ["a", "next"]] : [["a", "next"]]);
  expect(f.requests.filter(request => request.method === "thread/turns/list").map(request => request.params.cursor ?? null)).toEqual([null, "1"]);
  f.requests.length = 0; f.returnedPages.length = 0;
  await f.observer.poll(); await f.observer.poll();
  expect(f.requests.filter(request => request.method === "thread/turns/list")).toHaveLength(2);
  expect(f.returnedPages.map(page => page.map(turn => turn.id))).toEqual([["next"], ["next"]]);
  await f.observer.close();
});
