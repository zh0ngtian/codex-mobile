import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunProgress } from "../../src/features/conversation/RunProgress";

afterEach(cleanup);

describe("拉取执行进度", () => {
  it("仅待确认时仍显示独立状态，确认结束后移除", () => {
    const { rerender } = render(<RunProgress thread={{ turns: [] }} busy={false} sync={null} operationPending />);
    expect(screen.getByRole("status").textContent).toBe("发送状态确认中");
    expect(screen.queryByText("任务进行中")).toBeNull();
    rerender(<RunProgress thread={{ turns: [] }} busy={false} sync={null} operationPending={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("待确认提示不替代当前工具进度和计划", () => {
    render(<RunProgress thread={{ turns: [{ items: [{ type: "commandExecution", command: "npm test", status: "inProgress" }] }], mobilePlan: [{ step: "运行测试", status: "inProgress" }] }} busy sync={null} operationPending />);
    expect(screen.getByRole("status").textContent).toBe("发送状态确认中");
    expect(screen.getByText("正在执行命令 · npm test")).toBeTruthy();
    expect(screen.getByText("运行测试")).toBeTruthy();
  });
  it("显示当前工具活动和真实计划步骤", () => {
    render(<RunProgress thread={{ turns: [{ status: "inProgress", items: [{ type: "commandExecution", command: "npm test", status: "inProgress" }] }], mobilePlan: [{ step: "运行测试", status: "inProgress" }] }} busy sync={{ updatedAt: Date.now(), stale: false }} />);
    expect(screen.getByText(/正在执行命令/)).toBeTruthy();
    expect(screen.getByText("运行测试")).toBeTruthy();
  });
  it("离线时保留最后同步时间与等待审批状态", () => {
    render(<RunProgress thread={{ status: { type: "active", activeFlags: ["waitingOnApproval"] } }} busy sync={{ updatedAt: Date.now() - 10_000, stale: true }} />);
    expect(screen.getByText("等待你确认")).toBeTruthy();
    expect(screen.getByText(/连接暂时不可用/)).toBeTruthy();
    expect(screen.getByText(/10 秒前/)).toBeTruthy();
  });
  it("完成且同步正常时不持续显示运行卡片", () => {
    const { container } = render(<RunProgress thread={{ turns: [{ status: "completed" }] }} busy={false} sync={{ updatedAt: Date.now(), stale: false }} />);
    expect(container.textContent).toBe("");
  });
});
