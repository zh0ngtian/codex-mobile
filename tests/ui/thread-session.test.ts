import { describe, expect, it, vi } from "vitest";
import {
  loadRecoverableRecentThreadTurns,
  loadRecentThreadTurns,
  loadStableRecentThreadTurns,
  loadOlderThreadTurns,
  loadTurnChangeStatsPage,
  applyTurnChangeStats,
  applyTurnCommentary,
  loadRunningTurnCommentary,
  prependUniqueTurns,
  resumeThreadSession,
} from "../../src/app-server/thread-session";

describe("恢复已有 app-server 会话", () => {
  it("统计缺失仍补回图片，但不写入虚假的 0 行", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{
      id: "unknown", changeStatsUnavailable: true,
      items: [{ id: "image", type: "imageView", path: "/tmp/result.png" }],
    }] });
    const details = await loadTurnChangeStatsPage({ request }, "thread");
    const [turn] = applyTurnChangeStats([{ id: "unknown", status: "completed", itemsView: "summary", items: [] }], details);
    expect(turn.changeStatsUnavailable).toBe(true);
    expect(turn.loadedChangeStats).toBeUndefined();
    expect(turn.items).toMatchObject([{ path: "/tmp/result.png" }]);
  });
  it("完成时可只读取一个最近回合并补齐一个回合的统计和图片", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: "last", loadedChangeStats: { additions: 7, deletions: 3 }, items: [{ id: "image", type: "imageView", path: "/tmp/result.png" }] }] });
    await loadRecentThreadTurns({ request }, "thread", 1);
    expect(request.mock.calls[0][1].limit).toBe(1);
    const details = await loadTurnChangeStatsPage({ request }, "thread", undefined, 1);
    expect(request.mock.calls[1][1].limit).toBe(1);
    expect(details.last).toMatchObject({ additions: 7, deletions: 3, images: [{ path: "/tmp/result.png" }] });
  });
  it("从完整历史页提取改动行数并回填精简回合", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{
        id: "turn-1",
        items: [{ type: "fileChange", changes: [{
          diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+extra",
        }] }],
      }],
    });
    const stats = await loadTurnChangeStatsPage({ request }, "thread-1");
    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "thread-1",
      limit: 5,
      sortDirection: "desc",
      itemsView: "full",
    }, { timeoutMs: 60_000 });
    expect(applyTurnChangeStats([
      { id: "turn-1", itemsView: "summary", items: [] },
    ], stats)).toMatchObject([{
      loadedChangeStats: { additions: 2, deletions: 1 },
    }]);
  });
  it("将完整历史中的原生图片回填到精简回合，重复回填不产生副本", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{
      id: "turn-image",
      items: [
        { id: "user", type: "userMessage" },
        { id: "view", type: "imageView", path: "/tmp/assistant.png" },
        { id: "answer", type: "agentMessage", phase: "final_answer", text: "图片如下" },
      ],
    }] });
    const details = await loadTurnChangeStatsPage({ request }, "thread-1");
    const summary = [{ id: "turn-image", status: "completed", itemsView: "summary", items: [
      { id: "user", type: "userMessage" },
      { id: "answer", type: "agentMessage", phase: "final_answer", text: "图片如下" },
    ] }];
    const once = applyTurnChangeStats(summary, details);
    const twice = applyTurnChangeStats(once, details);
    expect(twice[0].items.map((item: { type: string }) => item.type)).toEqual([
      "userMessage", "imageView", "agentMessage",
    ]);
    expect(twice[0].items[1].path).toBe("/tmp/assistant.png");
    expect(twice[0].loadedMediaStatus).toBe("completed");
  });
  it("优先 thread/resume 并返回线程的有效设置", async () => {
    const request = vi.fn().mockResolvedValue({
      thread: { id: "thread-1", turns: [] },
      initialTurnsPage: {
        data: [
          { id: "turn-2", items: [{ id: "item-2" }] },
          { id: "turn-1", items: [{ id: "item-1" }] },
        ],
        nextCursor: "older-cursor",
      },
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      serviceTier: "priority",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      activePermissionProfile: { id: ":workspace" },
    });

    const result = await resumeThreadSession({ request }, "thread-1");

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "thread/resume",
      {
        threadId: "thread-1",
        excludeTurns: true,
        initialTurnsPage: {
          limit: 5,
          sortDirection: "desc",
          itemsView: "summary",
        },
      },
      { timeoutMs: 60_000 },
    );
    expect(result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextTurnsCursor).toBe("older-cursor");
    expect(result.accessMode).toBe("interactive");
    expect(result.resumeError).toBeUndefined();
    expect(result.settingsSynchronized).toBe(true);
    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.reasoningEffort).toBe("high");
    expect(result.serviceTier).toBe("priority");
    expect(result.approvalPolicy).toBe("on-request");
    expect(result.approvalsReviewer).toBe("auto_review");
    expect(result.activePermissionProfile?.id).toBe(":workspace");
  });

  it("resume 被其他写入者占用时使用只读分页接口恢复", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("thread-store conflict: thread already has an active writer"),
      )
      .mockResolvedValueOnce({
        thread: { id: "thread-1", title: "Paginated thread" },
      })
      .mockResolvedValueOnce({
        data: [{ id: "turn-2" }, { id: "turn-1" }],
        nextCursor: "older-cursor",
      });

    const result = await resumeThreadSession({ request }, "thread-1");

    expect(request).toHaveBeenNthCalledWith(2, "thread/read", {
      threadId: "thread-1",
      includeTurns: false,
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "thread/turns/list",
      {
        threadId: "thread-1",
        limit: 5,
        sortDirection: "desc",
        itemsView: "summary",
      },
      { timeoutMs: 60_000 },
    );
    expect(result.settingsSynchronized).toBe(false);
    expect(result.thread.id).toBe("thread-1");
    expect(result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextTurnsCursor).toBe("older-cursor");
    expect(result.accessMode).toBe("readOnly");
    expect(result.resumeError).toContain("active writer");
    expect(request).not.toHaveBeenCalledWith("thread/read", {
      threadId: "thread-1",
      includeTurns: true,
    });
  });

  it("resume 的非 writer 错误保留原始原因且不读取历史", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("app-server connection closed"));

    await expect(
      resumeThreadSession({ request }, "thread-1"),
    ).rejects.toThrow("app-server connection closed");

    expect(request).toHaveBeenCalledOnce();
  });

  it("使用游标获取更早 turns 并转换为时间正序", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ id: "turn-2" }, { id: "turn-1" }],
      nextCursor: "next-older",
    });

    const result = await loadOlderThreadTurns(
      { request },
      "thread-1",
      "older-cursor",
    );

    expect(request).toHaveBeenCalledWith(
      "thread/turns/list",
      {
        threadId: "thread-1",
        cursor: "older-cursor",
        limit: 5,
        sortDirection: "desc",
        itemsView: "summary",
      },
      { timeoutMs: 60_000 },
    );
    expect(result.turns.map((turn) => String(turn.id))).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextCursor).toBe("next-older");
  });

  it("获取最新轻量 turns 用于回到前台后的增量对账", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        { id: "turn-3", status: "completed" },
        { id: "turn-2", status: "completed" },
      ],
      nextCursor: "older",
    });

    const result = await loadRecentThreadTurns(
      { request },
      "thread-1",
    );

    expect(request).toHaveBeenCalledWith(
      "thread/turns/list",
      {
        threadId: "thread-1",
        limit: 5,
        sortDirection: "desc",
        itemsView: "summary",
      },
      { timeoutMs: 60_000 },
    );
    expect(result.map((turn) => turn.id)).toEqual(["turn-2", "turn-3"]);
  });

  it("对账请求期间收到实时事件时重新读取稳定快照", async () => {
    let notificationSequence = 0;
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        notificationSequence += 1;
        return { data: [{ id: "turn-stale" }] };
      })
      .mockResolvedValueOnce({ data: [{ id: "turn-current" }] });

    const result = await loadStableRecentThreadTurns(
      { request },
      "thread-1",
      () => notificationSequence,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(result?.map((turn) => turn.id)).toEqual(["turn-current"]);
  });

  it("前台恢复快照短暂失败时按退避重试且不要求重连", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ data: [{ id: "turn-current" }] });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await loadRecoverableRecentThreadTurns(
      { request },
      "thread-1",
      () => 0,
      wait,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(300);
    expect(result?.map((turn) => turn.id)).toEqual(["turn-current"]);
  });

  it("向前插入分页结果时按 id 去重且保留现有实时 turn", () => {
    expect(
      prependUniqueTurns(
        [{ id: "turn-2" }, { id: "turn-3", status: "running" }],
        [{ id: "turn-1" }, { id: "turn-2", status: "completed" }],
      ),
    ).toEqual([
      { id: "turn-1" },
      { id: "turn-2" },
      { id: "turn-3", status: "running" },
    ]);
  });
});


describe('运行文本回填', () => {
  it('只请求最新运行且尚无 final 的回合，无运行回合时不发请求', async () => {
    const request = vi.fn().mockResolvedValue({ turnId: 'live', items: [] });
    await loadRunningTurnCommentary({ request }, 't', [{ id: 'old', status: 'completed' }, { id: 'live', status: 'inProgress', items: [] }]);
    expect(request).toHaveBeenCalledWith('mobile/turns/commentary', { threadId: 't', turnId: 'live' }, { timeoutMs: 60_000 });
    request.mockClear();
    for (const turn of [{ id: 'done', status: 'completed' }, { id: 'live', status: 'inProgress', items: [{ type: 'agentMessage', phase: 'final_answer' }] }]) {
      expect(await loadRunningTurnCommentary({ request }, 't', [turn])).toBeNull();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('按 ID 保持插话顺序、较长实时文本与用户附件，迟到回填不影响 final 和完成状态', () => {
    const turns = [{ id: 'live', status: 'completed', items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '开始' }, { type: 'image', url: '/tmp/a.png' }] },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '检查文件已经完成' },
      { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '完成' },
    ] }];
    const detail = { turnId: 'live', items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '开始' }] },
      { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '开始检查' },
      { id: 'steer', type: 'userMessage', text: '继续' },
      { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '检查文件' },
    ] };
    const once = applyTurnCommentary(turns, detail);
    expect(applyTurnCommentary(once, detail)).toEqual(once);
    expect(once[0].items.map((item: any) => item.id)).toEqual(['u', 'c1', 'steer', 'c2', 'f']);
    expect(once[0].items[3].text).toBe('检查文件已经完成');
    expect(once[0].items[0].content).toHaveLength(2);
    expect(once[0].status).toBe('completed');
    expect(applyTurnCommentary([{ id: 'next', items: [] }], detail)).toEqual([{ id: 'next', items: [] }]);
  });
});


it('同一消息已转为最终回复时，旧 commentary 不能覆盖其阶段或正文', () => {
  const turns = [{ id: 't', status: 'inProgress', items: [{ id: 'same', type: 'agentMessage', phase: 'final_answer', text: '最终答复' }] }];
  expect(applyTurnCommentary(turns, { turnId: 't', items: [{ id: 'same', type: 'agentMessage', phase: 'commentary', text: '之前更长的过程说明' }] })).toEqual(turns);
});


describe('完成摘要的 commentary 恢复', () => {
  const first = { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '第一段过程' };
  const second = { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '第二段过程' };
  it.each(['compact', 'full'])('复用 %s 详情读取，恢复 commentary、final与插话顺序且不截短实时文本', async (view) => {
    const user = { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '开始' }, { type: 'image', url: '/tmp/a.png' }] };
    const f1 = { id: 'f1', type: 'agentMessage', phase: 'final_answer', text: '第一版完成' };
    const steer = { id: 'steer', type: 'userMessage', text: '继续' };
    const f2 = { id: 'f2', type: 'agentMessage', phase: 'final_answer', text: '最终完成' };
    const history = [user, first, f1, steer, second, f2];
    const request = vi.fn().mockResolvedValue({ data: [{ id: 'done', changeStatsUnavailable: true,
      ...(view === 'compact' ? { items: [], commentaryItems: [first, second], messageOrder: history.map(i => i.id) } : { items: history }),
    }] });
    const detail = await loadTurnChangeStatsPage({ request }, 't');
    const summary = [{ id: 'done', status: 'completed', itemsView: 'summary', items: [user, f1, steer, { ...second, text: '第二段过程已验证通过' }, f2] }];
    const once = applyTurnChangeStats(summary, detail);
    expect(once[0].items.map((i: any) => i.id)).toEqual(history.map(i => i.id));
    expect(once[0].items[4].text).toBe('第二段过程已验证通过');
    expect(once[0].items[0].content).toHaveLength(2);
    expect(once[0].changeStatsUnavailable).toBe(true);
    expect(once[0].loadedChangeStats).toBeUndefined();
    expect(applyTurnChangeStats(once, detail)).toEqual(once);
    expect(request).toHaveBeenCalledTimes(1);
  });
});


describe('commentary 与媒体有序回填', () => {
  const c1 = { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '检查', timestamp: 1792026420 };
  const c2 = { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '验证', timestamp: 1792026540 };
  const img1 = { id: 'i1', type: 'imageView', path: '/one.png' };
  const img2 = { id: 'i2', type: 'imageView', path: '/two.png' };
  const final = { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '完成' };
  it.each(['compact', 'full'])('%s 详情先合并截图再按原始顺序排序并保留分钟时间', async view => {
    const history = [c1, img1, c2, img2, final];
    const request = vi.fn().mockResolvedValue({ data: [{ id: 't', items: view === 'full' ? history : [img1, img2],
      ...(view === 'compact' ? { commentaryItems: [c1,c2], messageOrder: history.map(i => i.id) } : {}) }] });
    const details = await loadTurnChangeStatsPage({ request }, 'thread');
    const once = applyTurnChangeStats([{ id: 't', status: 'completed', items: [{ ...c2, text: '验证已经完成' }, final] }], details);
    expect(once[0].items.map((i: any) => i.id)).toEqual(['c1','i1','c2','i2','f']);
    expect(once[0].items[0].timestamp).toBe(c1.timestamp);
    expect(once[0].items[2].text).toBe('验证已经完成');
    expect(applyTurnChangeStats(once, details)).toEqual(once);
    const restored = applyTurnCommentary(once, { turnId: 't', items: [{ ...c1, timestamp: undefined }, c2] });
    expect(restored[0].items.map((i: any) => i.id)).toEqual(['c1','i1','c2','i2','f']);
    expect(restored[0].items[0].timestamp).toBe(c1.timestamp);
  });
  it('没有 commentary 仍按媒体位置排序', async () => {
    const history = [img1, final, img2];
    const request = vi.fn().mockResolvedValue({ data: [{ id:'t', items:history }] });
    const details = await loadTurnChangeStatsPage({ request }, 'thread');
    const result = applyTurnChangeStats([{id:'t', items:[final]}],details);
    expect(result[0].items.map((i:any)=>i.id)).toEqual(['i1','f','i2']);
  });
});

it('迟到的不完整顺序不能把已显示的插话与较新的截图移到旧 final 后', () => {
 const c1={id:'c1',type:'agentMessage',phase:'commentary',text:'检查'};
 const img={id:'i1',type:'imageView',path:'/one.png'};
 const steer={id:'u2',type:'userMessage',text:'继续'};
 const newImage={id:'i2',type:'imageView',path:'/two.png'};
 const final={id:'f',type:'agentMessage',phase:'final_answer',text:'完成'};
 const current=[{id:'t',status:'completed',items:[c1,img,steer,newImage,final]}];
 const result=applyTurnChangeStats(current,{t:{images:[img],commentaryItems:[c1],messageOrder:['c1','i1','f'],unavailable:true}});
 expect(result[0].items.map((i:any)=>i.id)).toEqual(['c1','i1','u2','i2','f']);
});

it('running commentary 的媒体顺序与详情并发重复回填后保持一致', async () => {
 const c1={id:'c1',type:'agentMessage',phase:'commentary',text:'检查',timestamp:123};
 const c2={id:'c2',type:'agentMessage',phase:'commentary',text:'验证',timestamp:456};
 const img1={id:'i1',type:'imageView',path:'/one.png'};
 const img2={id:'i2',type:'imageView',path:'/two.png'};
 const history=[c1,img1,c2,img2];
 const commentary={turnId:'t',items:[c1,c2],messageOrder:history.map(i=>i.id)};
 const details={t:{images:[img1,img2],commentaryItems:[c1,c2],messageOrder:history.map(i=>i.id),unavailable:true}};
 const turns=[{id:'t',status:'inProgress',items:[img1,{...c2,text:'验证全部通过'},img2]}];
 for(const reverse of [false,true]){
  const result=reverse?applyTurnCommentary(applyTurnChangeStats(turns,details),commentary):applyTurnChangeStats(applyTurnCommentary(turns,commentary),details);
  expect(result[0].items.map((i:any)=>i.id)).toEqual(history.map(i=>i.id));
  expect(result[0].items[2].text).toBe('验证全部通过');
  expect(result[0].items[2].timestamp).toBe(456);
 }
});

it('详情保留视频路径与无路径失败生成项，按消息顺序放回', async () => {
 const c={id:'c',type:'agentMessage',phase:'commentary',text:'生成'};
 const video={id:'v',type:'videoGeneration',path:'/clip.mp4',status:'completed'};
 const failed={id:'bad',type:'imageGeneration',status:'failed'};
 const remote={id:'g',type:'imageGeneration',result:'https://images.invalid/one.png'};
 const final={id:'f',type:'agentMessage',phase:'final_answer',text:'完成'};
 const history=[c,video,failed,remote,final];
 const request=vi.fn().mockResolvedValue({data:[{id:'t',items:history}]});
 const details=await loadTurnChangeStatsPage({request},'thread');
 const restored=applyTurnChangeStats([{id:'t',items:[final]}],details);
 expect(restored[0].items.map((i:any)=>i.id)).toEqual(history.map(i=>i.id));
 expect(restored[0].items.find((i:any)=>i.id==='v')).toMatchObject(video);
 expect(restored[0].items.find((i:any)=>i.id==='bad')).toMatchObject(failed);
});

it('无 messageOrder 的旧 commentary 根据前锚点插入，不能越过较新用户插话', () => {
 const u1={id:'u1',type:'userMessage',text:'先检查'};
 const c1={id:'c1',type:'agentMessage',phase:'commentary',text:'开始检查',timestamp:123};
 const u2={id:'u2',type:'userMessage',text:'继续检查',content:[{type:'image',url:'/latest.png'}]};
 const c2={id:'c2',type:'agentMessage',phase:'commentary',text:'继续验证'};
 const turns=[{id:'t',status:'inProgress',items:[u1,u2,c2]}];
 const detail={turnId:'t',items:[u1,c1]};
 const result=applyTurnCommentary(turns,detail);
 expect(result[0].items.map((item:any)=>item.id)).toEqual(['u1','c1','u2','c2']);
 expect(applyTurnCommentary(result,detail)).toEqual(result);
 expect(result[0].items[2]).toEqual(u2);
});

it.each([false,true])('回填仅按用户消息精确ID合并，不将旧用户吞并新用户，完整顺序=%s', withOrder => {
 const u1={id:'u1',type:'userMessage',text:'旧问题'};
 const c1={id:'c1',type:'agentMessage',phase:'commentary',text:'旧过程',timestamp:123};
 const u2={id:'u2',type:'userMessage',text:'新问题',content:[{type:'image',url:'/latest.png'}]};
 const c2={id:'c2',type:'agentMessage',phase:'commentary',text:'新过程',timestamp:456};
 const detail={turnId:'t',items:[u1,c1],...(withOrder?{messageOrder:['u1','c1','u2','c2']}:{})};
 const result=applyTurnCommentary([{id:'t',status:'inProgress',items:[u2,c2]}],detail);
 expect(result[0].items.every(Boolean)).toBe(true);
 expect(result[0].items).toHaveLength(4);
 expect(result[0].items.find((item:any)=>item.id==='u1')).toEqual(u1);
 expect(result[0].items.find((item:any)=>item.id==='u2')).toEqual(u2);
 if(withOrder) expect(result[0].items.map((item:any)=>item.id)).toEqual(['u1','c1','u2','c2']);
 expect(applyTurnCommentary(result,detail)).toEqual(result);
});
