import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApprovalRequests } from "../../src/features/approvals/useApprovalRequests";
import { approvalResponse, questionResponse } from "../../src/features/approvals/approval-model";
import { HttpOperationPendingError } from "../../src/backends/http-transport";
import type { RpcMessage } from "../../src/app-server/client";
const question = (id: string | number): RpcMessage => ({ id, method: "item/tool/requestUserInput", params: { threadId: "t1", questions: [{ id: "q", header: "问题", question: "答案？", options: null, isOther: true, isSecret: false }] } });
describe("App 审批请求状态", () => {
  it("同步快照保留当前草稿，resolved 按请求与线程移除，不把回答带到下一条", () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => { result.current.receive(question(1)); result.current.receive(question("1")); });
    act(() => result.current.answer("q", "第一条"));
    act(() => result.current.onNotification({ method: "mobile/requests", params: { requests: [question(1), question("1")] } }));
    expect(result.current.userAnswers).toEqual({ q: "第一条" });
    act(() => result.current.onNotification({ method: "serverRequest/resolved", params: { requestId: 1, threadId: "other" } }));
    expect(result.current.requests).toHaveLength(2);
    act(() => result.current.onNotification({ method: "serverRequest/resolved", params: { requestId: 1, threadId: "t1" } }));
    expect(result.current.approval?.id).toBe("1");
    expect(result.current.userAnswers).toEqual({});
  });
  it("失败保留回答并支持重试，提交期间阻止重复发送", async () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    act(() => result.current.answer("q", "保留"));
    let reject!: (reason: Error) => void;
    const respond = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.submit({ answers: {} }, { respond }, vi.fn()); });
    await act(() => result.current.submit({ answers: {} }, { respond }, vi.fn()));
    expect(respond).toHaveBeenCalledOnce();
    expect(result.current.submitting).toBe(true);
    await act(async () => { reject(new Error("断线")); await pending; });
    expect(result.current.userAnswers).toEqual({ q: "保留" });
    expect(result.current.error).toBe("断线");
    await act(() => result.current.submit({ answers: {} }, { respond: vi.fn() }, vi.fn()));
    expect(result.current.requests).toEqual([]);
  });
  it("HTTP 结果待确认保持锁定，失败确认解锁且成功确认只移除原请求", async () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    act(() => result.current.answer("q", "保留"));
    let confirm!: (response: RpcMessage) => void;
    const pending = new HttpOperationPendingError("op", { id: 1, result: {} });
    const remember = vi.fn((_id: string, callback: (response: RpcMessage) => void) => { confirm = callback; });
    await act(() => result.current.submit({}, { respond: () => Promise.reject(pending) }, remember));
    expect(result.current.submitting).toBe(true);
    act(() => confirm({ error: { code: -1, message: "失败" } }));
    expect(result.current.error).toBe("失败");
    expect(result.current.submitting).toBe(false);
    expect(result.current.userAnswers.q).toBe("保留");
    await act(() => result.current.submit({}, { respond: () => Promise.reject(pending) }, remember));
    act(() => result.current.receive(question(2)));
    act(() => confirm({ result: {} }));
    expect(result.current.approval?.id).toBe(2);
    expect(result.current.userAnswers).toEqual({});
  });
  it("前一条已解决后的异步结果不能清除下一条草稿；重置隔离旧连接", async () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    let finish!: () => void;
    let pending!: Promise<void>;
    act(() => { pending = result.current.submit({}, { respond: () => new Promise<void>((resolve) => { finish = resolve; }) }, vi.fn()); });
    act(() => { result.current.reset(); result.current.receive(question(1)); });
    act(() => result.current.answer("q", "新连接"));
    await act(async () => { finish(); await pending; });
    expect(result.current.userAnswers.q).toBe("新连接");
    expect(result.current.requests).toHaveLength(1);
  });
  it("已显示请求在点击前被解决时，不会把旧响应发给新的队首", async () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    const displayed = result.current.approval!;
    act(() => result.current.onNotification({ method: "mobile/requests", params: { requests: [question(2)] } }));
    const respond = vi.fn();
    await act(() => result.current.submit({}, { respond }, vi.fn(), displayed));
    expect(respond).not.toHaveBeenCalled();
    expect(result.current.approval?.id).toBe(2);
  });
  it.each(["serverRequest/resolved", "mobile/requests"])("%s 解除对应审批的待确认忙碌状态，不误清回合操作", async (method) => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    const operations = new Map<string, string>([["turn-op", "turn/start"]]);
    const cleanup = vi.fn(() => { operations.delete("approval-op"); });
    await act(() => result.current.submit({}, {
      respond: () => Promise.reject(new HttpOperationPendingError("approval-op", { id: 1, result: {} })),
    }, () => { operations.set("approval-op", "approval"); return cleanup; }));
    expect(operations.has("approval-op")).toBe(true);
    act(() => result.current.onNotification({ method, params: method === "mobile/requests" ? { requests: [] } : { threadId: "t1", requestId: 1 } }));
    expect(cleanup).toHaveBeenCalledOnce();
    expect([...operations]).toEqual([["turn-op", "turn/start"]]);
  });
  it("请求先被解决、HTTP 后返回待确认时不再注册会锁住聊天的孤立操作", async () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    let reject!: (reason: Error) => void;
    let sending!: Promise<void>;
    const remember = vi.fn();
    act(() => { sending = result.current.submit({}, { respond: () => new Promise<void>((_resolve, fail) => { reject = fail; }) }, remember); });
    act(() => result.current.onNotification({ method: "mobile/requests", params: { requests: [] } }));
    await act(async () => { reject(new HttpOperationPendingError("late", { id: 1, result: {} })); await sending; });
    expect(remember).not.toHaveBeenCalled();
  });
  it("失败确认释放关联后，后续直接重试不再释放旧操作", async () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.receive(question(1)));
    let confirm!: (response: RpcMessage) => void;
    const cleanup = vi.fn();
    await act(() => result.current.submit({}, { respond: () => Promise.reject(new HttpOperationPendingError("old", { id: 1, result: {} })) }, (_id, callback) => { confirm = callback; return cleanup; }));
    act(() => confirm({ error: { code: -1, message: "retry" } }));
    expect(cleanup).toHaveBeenCalledOnce();
    await act(() => result.current.submit({}, { respond: vi.fn() }, vi.fn()));
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("快照不会扩展到未知请求，重复投递只出现一次", () => {
    const { result } = renderHook(useApprovalRequests);
    act(() => result.current.onNotification({ method: "mobile/requests", params: { requests: [question(1), question(1), { id: 9, method: "unknown" }] } }));
    expect(result.current.requests).toHaveLength(1);
  });
  it("只允许协议列出的决策，权限响应保留范围且空白答案不可提交", () => {
    const req = { id: 2, method: "item/permissions/requestApproval", params: { permissions: { network: { enabled: true }, fileSystem: null } } };
    expect(approvalResponse(req, "acceptForSession")).toEqual({ permissions: { network: { enabled: true } }, scope: "session" });
    expect(approvalResponse(req, "decline")).toEqual({ permissions: {}, scope: "turn" });
    expect(approvalResponse({ ...req, method: "item/commandExecution/requestApproval", params: { availableDecisions: ["cancel"] } }, "accept")).toBeNull();
    expect(questionResponse(question(1), { q: " \n " })).toBeNull();
    expect(questionResponse(question(1), { q: " secret " })).toEqual({ answers: { q: { answers: [" secret "] } } });
  });
});
