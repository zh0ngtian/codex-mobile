import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TurnCard } from "../../../src/features/conversation/Timeline";
import { ConversationActionMenu } from "../../../src/features/conversation/ConversationControls";
import { ThreadListPage } from "../../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../../src/features/threads/thread-list-model";
import "../../../src/styles.css";

function NativeMenuFixture() {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("原生菜单验收消息");
  const [threadMenu, setThreadMenu] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [opened, setOpened] = useState(false);
  const backend = { id: "fixture", name: "验收设备", baseUrl: "", token: "", enabled: true, order: 0 };
  const threads = aggregateThreads([backend], { fixture: [{
    id: "sidebar-thread", preview: "取消菜单后进入会话", cwd: "/fixture", updatedAt: 1,
    isPinned: pinned, status: { type: "idle" },
  }] });
  if (sidebar) return <div style={{ position: "fixed", inset: 0 }}>
    <ThreadListPage backends={[backend]} summaries={{ fixture: {
      backendId: "fixture", connection: "online", busy: false, approvalCount: 0, error: "",
    } }} selectedBackendId="all"
      loadingBackendIds={new Set()} refreshing={false} threadListState="ready"
      visibleThreads={threads} totalThreadCount={1} projectDirectories={["/fixture"]}
      hasProjectlessThreads={false} projectThreadStates={{}} projectHasMore={{}}
      collapsedProjectKeys={new Set()} loadingProjectKeys={new Set()} openingThreadId=""
      query="" searching={false} error="" onQueryChange={() => {}}
      onOpenThread={() => { setOpened(true); setSidebar(false); }}
      onManageThread={async (_, action) => { if (action === "pin") setPinned((value) => !value); return true; }}
      onNewChat={() => {}} onSelectBackend={() => {}} onManageBackends={() => {}}
      onRefresh={() => {}} onRetryProject={() => {}} onToggleProject={() => {}}
      onToggleProjectCollapsed={() => {}} />
  </div>;
  return <main style={{ padding: "100px 20px" }}>
    <TurnCard client={null} onEditUserMessage={() => setEditing(true)}
      turn={{ id: "fixture-turn", status: "completed", items: [
        { id: "fixture-user", type: "userMessage", text: "原生菜单验收消息" },
      ] }} inlineEdit={editing ? {
        messageId: "fixture-user", value: text, submitting: false, attachmentCount: 0, hasLaterTurns: false,
        onChange: setText, onCancel: () => setEditing(false), onSubmit: () => setEditing(false),
      } : undefined} />
    <button onClick={() => setThreadMenu(true)}>打开会话菜单验收</button>
    <p>{pinned ? "会话已置顶" : "会话未置顶"}</p>
    <ConversationActionMenu open={threadMenu} pendingAction="" thread={{ id: "fixture-thread", name: "验收会话", isPinned: pinned }}
      anchor={{ x: 20, y: 300, width: 240, height: 44 }} onClose={() => setThreadMenu(false)}
      onPin={() => { setPinned((value) => !value); setThreadMenu(false); }}
      onRefresh={() => setThreadMenu(false)} onDuplicate={() => setThreadMenu(false)}
      onCopy={() => setThreadMenu(false)} onRename={() => setThreadMenu(false)} onArchive={() => setThreadMenu(false)} />
    <textarea aria-label="剪贴板验收" />
    <button onClick={() => setSidebar(true)}>打开侧栏验收</button>
    {opened && <p>已进入侧栏会话</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<NativeMenuFixture />);
