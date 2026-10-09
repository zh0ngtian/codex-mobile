import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalSheet } from "../../src/features/approvals/ApprovalSheet";
import type { RpcMessage } from "../../src/app-server/client";

afterEach(cleanup);
const request = (method: string, params: object): RpcMessage => ({ id: 1, method: `item/${method}`, params });
const question = { id: "choice", header: "方案", question: "选择哪种方案？", isOther: true, isSecret: false, options: [{ label: "快速", description: "减少等待时间" }, { label: "完整", description: "检查所有文件" }] };
function show(approval: RpcMessage, extra = {}) {
  const onDecision = vi.fn();
  const onSubmitAnswers = vi.fn();
  function Harness() {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    return <ApprovalSheet approval={approval} userAnswers={answers} onAnswerChange={(id, value) => setAnswers((old) => ({ ...old, [id]: value }))} onSubmitAnswers={onSubmitAnswers} onDecision={onDecision} {...extra} />;
  }
  return { ...render(<Harness />), onDecision, onSubmitAnswers };
}
describe("审批与问题表单", () => {
  it("将命令原因和目录展示为可读详情，只提供服务器允许的决策", () => {
    const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } };
    const { onDecision } = show(request("commandExecution/requestApproval", { command: "npm test", cwd: "/work/app", reason: "验证改动", availableDecisions: [amendment, "cancel"] }));
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("/work/app")).toBeTruthy();
    expect(screen.getByText("验证改动")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /允许并记住命令前缀/ }));
    expect(onDecision).toHaveBeenCalledWith(amendment);
  });
  it("展示选项说明，未回答禁用提交，可选择自定义文字", () => {
    const { onSubmitAnswers } = show(request("tool/requestUserInput", { questions: [question] }));
    expect(screen.getByText("减少等待时间")).toBeTruthy();
    expect(screen.getByRole("button", { name: "提交回答" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /其他/ }));
    const input = screen.getByLabelText("自定义回答：方案");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "提交回答" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "折中方案" } });
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
    expect(onSubmitAnswers).toHaveBeenCalledOnce();
  });
  it("isOther=false 不提供自定义，保密回答使用密码输入", () => {
    show(request("tool/requestUserInput", { questions: [{ ...question, isOther: false }, { ...question, id: "secret", header: "密钥", question: "请输入密钥", options: null, isSecret: true }] }));
    expect(screen.queryByRole("radio", { name: /其他/ })).toBeNull();
    expect(screen.getByLabelText("请输入密钥")).toHaveAttribute("type", "password");
  });
  it("提交中锁定输入，显示失败原因且保留已有回答", () => {
    show(request("tool/requestUserInput", { questions: [{ ...question, options: null }] }), { submitting: true, error: "网络不可用", userAnswers: { choice: "保留内容" } });
    expect(screen.getByLabelText(question.question)).toBeDisabled();
    expect(screen.getByLabelText(question.question)).toHaveValue("保留内容");
    expect(screen.getByRole("status")).toHaveTextContent("正在提交");
    expect(screen.getByRole("alert")).toHaveTextContent("网络不可用");
  });
  it("文件变更展示授权根目录，权限审批提供回合和会话范围", () => {
    const view = show(request("fileChange/requestApproval", { grantRoot: "/work/output", reason: "写入报告" }));
    expect(screen.getByText("/work/output")).toBeTruthy();
    expect(screen.getByRole("button", { name: "本会话允许" })).toBeTruthy();
    view.unmount();
    const { onDecision } = show(request("permissions/requestApproval", { permissions: { network: { enabled: true }, fileSystem: { write: ["/work/output"], read: null } } }));
    expect(screen.getByText("/work/output")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "本会话允许" }));
    expect(onDecision).toHaveBeenCalledWith("acceptForSession");
  });
});
