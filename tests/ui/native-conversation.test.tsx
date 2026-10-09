import { createRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import { nativeConversationRows } from "../../src/features/conversation/native-conversation";

const posts: any[] = [];
const change = vi.fn();
const submit = vi.fn();
function Harness({ readOnly = false, thread = "thread", busy = false, foreground = true }: { readOnly?: boolean; thread?: string; busy?: boolean; foreground?: boolean }) {
  const [draft, setDraft] = useState("");
  return <ConversationPage {...{ nativeForeground: foreground }} active={{ id: thread, name: "原生会话", cwd: "/tmp/project", turns: [{
    id: "turn", status: "completed", items: [
      { id: "user", type: "userMessage", content: [{ type: "text", text: "中文问题" }] },
      { id: "tool", type: "commandExecution", command: "pwd", aggregatedOutput: "/tmp/project" },
      { id: "answer", type: "agentMessage", phase: "final_answer", text: "**中文回复**" },
    ],
  }] }} backendId="device" backendName="Mac" backends={[]} projectOptions={[]}
    loadState="ready" loadError="" olderTurnsState="idle" connection="online" client={null}
    error="" draft={draft} draftImages={[]} draftFiles={[]} imageReading={false} busy={busy}
    steering={false} steerable={false} pendingSteerText="" queuedFollowUps={[]}
    accessMode={readOnly ? "readOnly" : "interactive"} resumeError="" tokenUsage={null}
    rateLimits={null} pendingAction="" selectedServiceTier={null} selectedModelLabel="GPT"
    selectedEffort="medium" selectedPermissionLabel="默认" imageInputRef={createRef()}
    onBack={() => {}} onNewChatBackendChange={() => {}} onNewChatProjectChange={() => {}}
    onPin={async () => true} onDuplicate={async () => true} onRename={async () => true}
    onArchive={async () => true} onRetry={() => {}} onLoadOlderTurns={async () => true}
    onSubmit={(event) => { event.preventDefault(); submit(draft); setDraft(""); }}
    onRemoveImage={() => {}} onRemoveFile={() => {}} onSelectImages={async () => {}}
    onSelectLocation={async () => false} onOpenAgentSettings={() => {}} onOpenPermissionSettings={() => {}}
    onDraftChange={(text) => { change(text); setDraft(text); }} onInterrupt={() => {}}
    onQueuedFollowUpAction={() => {}}
    skills={[{ name: "neat-freak", description: "整理", path: "/skills/neat/SKILL.md", scope: "user", enabled: true }]} />;
}
function latest() { return posts.filter((post) => post.type === "snapshot").at(-1)?.snapshot; }
function action(type: string, sequence: number, extra: Record<string, unknown> = {}) {
  act(() => window.dispatchEvent(new CustomEvent("codex-mobile-native-conversation-action", {
    detail: { contextId: latest()?.contextId ?? "device:thread", sequence, type, ...extra },
  })));
}
beforeEach(() => {
  posts.length = 0; change.mockClear(); submit.mockClear();
  Object.assign(window, { __codexNativeConversationReady: true, webkit: { messageHandlers: {
    nativeConversation: { postMessage: (post: any) => posts.push(post) },
  } } });
});
afterEach(() => {
  cleanup(); delete (window as any).webkit; delete (window as any).__codexNativeConversationReady;
});

describe("iOS 原生对话桥接", () => {
  it("工具过程与过程说明折叠为活动，最终回复保持独立且不丢详情", () => {
    const rows = nativeConversationRows([{ id: "turn", status: "completed", items: [
      { id: "u", type: "userMessage", content: [{ type: "text", text: "问题" }] },
      { id: "c", type: "agentMessage", phase: "commentary", text: "正在检查实现" },
      { id: "x", type: "commandExecution", command: "pwd", aggregatedOutput: "完整工具输出" },
      { id: "y", type: "futureTool", output: "未知工具也保留" },
      { id: "a", type: "agentMessage", phase: "final_answer", text: "最终回复" },
    ] }]);
    expect(rows.map((row) => row.role)).toEqual(["user", "tool", "assistant"]);
    expect(rows[1].id).toBe("turn:activity");
    expect(rows[1].text).toBe("已完成 3 项活动");
    expect(rows[1].detail).toContain("完整工具输出");
    expect(rows[1].detail).toContain("正在检查实现");
    expect(rows[1].detail).toContain("未知工具也保留");
    expect(rows[2].text).toBe("最终回复");
  });
  it("后台隐藏设备的对话框不遮挡前台，hidden 切换后重新检测", async () => {
    const workspace = document.createElement("div"); workspace.hidden = true;
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
    workspace.append(dialog); document.body.append(workspace);
    render(<Harness />);
    await waitFor(() => expect(latest()?.visible).toBe(true));
    act(() => { workspace.hidden = false; });
    await waitFor(() => expect(latest()?.visible).toBe(false));
    act(() => workspace.remove());
    await waitFor(() => expect(latest()?.visible).toBe(true));
  });
  it("已有会话不显示无法切换的项目和设备选择", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()).toBeTruthy());
    expect(latest().projects).toEqual([]);
    expect(latest().backends).toEqual([]);
    expect(latest().isNewChat).toBe(false);
    expect(latest().locale).toBe("zh-CN");
  });
  it("选择 Skill 后回写插入位置，使后续输入不会破坏引用", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()).toBeTruthy());
    action("draft", 1, { text: "@ne", cursor: 3 });
    action("mention", 2, { id: "skill:/skills/neat/SKILL.md", cursor: 3 });
    await waitFor(() => expect(latest()?.draft).toBe("$neat-freak "));
    expect(latest().draftCursor).toBe(12);
    expect(latest().draftCursorSequence).toBe(2);
    action("draft", 3, { text: "$neat-freak 继续", cursor: 14 });
    expect(latest().draftCursor).toBeNull();
  });
  it("后台挂载的设备不覆盖当前原生会话，切换设备后只发布新的前台快照", async () => {
    const result = render(<><Harness thread="front" /><Harness thread="background" foreground={false} /></>);
    await waitFor(() => expect(latest()?.contextId).toBe("device:front"));
    expect(posts.filter((post) => post.type === "snapshot" && post.snapshot.contextId === "device:background")).toEqual([]);
    result.rerender(<><Harness thread="front" foreground={false} /><Harness thread="background" /></>);
    await waitFor(() => expect(latest()?.contextId).toBe("device:background"));
    action("draft", 1, { contextId: "device:front", text: "后台写入" });
    expect(change).not.toHaveBeenCalled();
  });
  it("投影稳定消息 ID、中文、工具输出和可交互状态", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()?.title).toBe("原生会话"));
    expect(latest().version).toBe(1);
    expect(latest().enabled).toBe(true);
    expect(latest().rows.map((row: any) => row.text)).toEqual(["中文问题", "已完成 1 项活动", "**中文回复**"]);
    expect(latest().rows[1].detail).toContain("/tmp/project");
    expect(new Set(latest().rows.map((row: any) => row.id)).size).toBe(3);
  });
  it("同步草稿，拒绝重复动作和旧会话事件", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()).toBeTruthy());
    action("draft", 1, { text: "中文草稿", cursor: 4 });
    action("draft", 1, { text: "重复" });
    action("draft", 2, { text: "旧会话", contextId: "device:old" });
    expect(change).toHaveBeenCalledExactlyOnceWith("中文草稿");
    expect(latest().draft).toBe("中文草稿");
    expect(latest().acknowledgedSequence).toBe(1);
  });
  it("提交先同步 React 草稿，发送最新文本一次并等待业务层清空", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()).toBeTruthy());
    action("submit", 3, { text: "最后一个中文字符" });
    action("submit", 3, { text: "最后一个中文字符" });
    await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith("最后一个中文字符"));
    expect(latest().draft).toBe("");
    expect(latest().acknowledgedSequence).toBe(3);
  });
  it("只读会话禁止原生草稿修改和提交", async () => {
    render(<Harness readOnly />);
    await waitFor(() => expect(latest()?.enabled).toBe(false));
    action("draft", 1, { text: "不能写" });
    action("submit", 2, { text: "不能发" });
    expect(change).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
  it("打开侧栏时隐藏原生层，关闭后恢复", async () => {
    render(<Harness />);
    await waitFor(() => expect(latest()?.visible).toBe(true));
    const sidebar = document.createElement("div"); sidebar.className = "conversation-sidebar-layer open";
    act(() => document.body.append(sidebar));
    await waitFor(() => expect(latest()?.visible).toBe(false));
    act(() => sidebar.remove());
    await waitFor(() => expect(latest()?.visible).toBe(true));
  });
  it("完整内容可以返回原生对话，卸载清理原生层", async () => {
    const result = render(<Harness />);
    await waitFor(() => expect(latest()?.visible).toBe(true));
    action("web", 1);
    await waitFor(() => expect(latest()?.visible).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "返回原生对话" }));
    await waitFor(() => expect(latest()?.visible).toBe(true));
    result.unmount();
    expect(posts.at(-1)).toEqual({ type: "hide", contextId: "device:thread" });
  });
  it("没有原生能力时维持 Web 界面", () => {
    delete (window as any).__codexNativeConversationReady;
    render(<Harness />);
    expect(posts).toEqual([]);
    expect(screen.getByRole("textbox", { name: "向 Codex 提问" })).toBeTruthy();
  });
});
