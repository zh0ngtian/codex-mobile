import React, { createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ConversationPage } from "../../../src/features/conversation/ConversationPage";
import { TurnCard } from "../../../src/features/conversation/Timeline";
import { ConversationActionMenu } from "../../../src/features/conversation/ConversationControls";
import { ThreadListPage } from "../../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../../src/features/threads/thread-list-model";
import "../../../src/styles.css";
import { useConversationAutoScroll } from "../../../src/features/conversation/conversation-scroll";

const historyText = "键盘滚动定位验收消息\n第二行\n第三行\n第四行\n第五行\n第六行";
const historyTurn = { id: "history-turn", status: "completed", items: [{ id: "history-user", type: "userMessage", text: historyText }] };
function HistoryEditorFixture() {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(historyText);
  const { scrollRef, contentRef, onScroll } = useConversationAutoScroll({
    threadId: "history-fixture", contentRevision: historyTurn, ready: true,
    historyEditMessageId: editing ? "history-user" : undefined,
  });
  return <main className="conversation">
    <header className="conversation-header">
      <button className="round-button" type="button">☰</button>
      <div className="thread-heading"><strong>历史编辑定位验收</strong><span>隔离网关验收</span></div>
      <div className="conversation-header-actions"><button type="button">⋯</button></div>
    </header>
    <div className="conversation-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="conversation-scroll-content" ref={contentRef}><div className="timeline">
        <div style={{ height: 280 }}>前面的历史回答</div>
        <TurnCard client={null} turn={historyTurn}
          onEditUserMessage={() => flushSync(() => setEditing(true))}
          inlineEdit={editing ? { messageId: "history-user", value: text, submitting: false,
            attachmentCount: 0, hasLaterTurns: false, onChange: setText,
            onCancel: () => setEditing(false), onSubmit: () => setEditing(false) } : undefined} />
        <div style={{ height: 300 }}>后面的历史回答</div>
      </div></div>
    </div>
    <form className="composer-wrap">
      <div className="chips"><button type="button" aria-label="模型验收">GPT 测试</button><button type="button">完全访问权限</button></div>
      <div className="composer">
        <button type="button" disabled>＋</button>
        <textarea aria-label="底部输入栏验收" placeholder="向 Codex 提问" disabled={editing} />
        <button type="button" disabled>□</button><button type="button" disabled>↑</button>
      </div>
    </form>
  </main>;
}

function SkillPickerFixture() {
  const [draft, setDraft] = useState("");
  return <ConversationPage
    active={{ id: "skill-fixture", cwd: "/fixture", preview: "Skill 选择验收", turns: [] }}
    backendId="fixture" backendName="验收设备" backends={[]} projectOptions={[]}
    loadState="ready" loadError="" olderTurnsState="exhausted" connection="online" client={null}
    error="" draft={draft} draftImages={[]} draftFiles={[]} imageReading={false}
    busy={false} steering={false} steerable pendingSteerText="" queuedFollowUps={[]}
    accessMode="interactive" resumeError="" tokenUsage={null} rateLimits={null} pendingAction=""
    selectedServiceTier={null} selectedModelLabel="Codex" selectedEffort={null} selectedPermissionLabel="工作区"
    skills={Array.from({ length: 8 }, (_, i) => ({ name: i === 0 ? "pdf" : `skill-${i}`,
      description: i === 0 ? "Read PDF files" : `Skill ${i} for touch and scroll verification`,
      path: `/skills/${i}/SKILL.md`, scope: "user" as const, enabled: true }))}
    plugins={[]} imageInputRef={createRef<HTMLInputElement>()}
    onBack={() => {}} onNewChatBackendChange={() => {}} onNewChatProjectChange={() => {}}
    onPin={async () => true} onDuplicate={async () => true} onRename={async () => true}
    onArchive={async () => true} onRetry={() => {}} onLoadOlderTurns={async () => true}
    onSubmit={event => event.preventDefault()} onRemoveImage={() => {}} onRemoveFile={() => {}}
    onSelectImages={async () => {}} onSelectLocation={async () => false}
    onOpenAgentSettings={() => {}} onOpenPermissionSettings={() => {}} onDraftChange={setDraft}
    onInterrupt={() => {}} onQueuedFollowUpAction={() => {}}
  />;
}

function NativeMenuFixture() {
  const [skillFixture, setSkillFixture] = useState(false);
  const [orderFixture, setOrderFixture] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("原生菜单验收消息");
  const [threadMenu, setThreadMenu] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [opened, setOpened] = useState(false);
  const [historyFixture, setHistoryFixture] = useState(false);
  const backend = { id: "fixture", name: "验收设备", baseUrl: "", token: "", enabled: true, order: 0 };
  const threads = aggregateThreads([backend], { fixture: [{
    id: "sidebar-thread", preview: "取消菜单后进入会话", cwd: "/fixture", updatedAt: 1,
    isPinned: pinned, status: { type: "idle" },
  }] });
  if (skillFixture) return <SkillPickerFixture />;
  if (historyFixture) return <HistoryEditorFixture />;
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
      anchor={{ x: 20, y: orderFixture ? (pinned ? 80 : window.innerHeight - 100) : 300, width: 240, height: 44 }} onClose={() => setThreadMenu(false)}
      onPin={() => { setPinned((value) => !value); setThreadMenu(false); }}
      onRefresh={() => setThreadMenu(false)} onDuplicate={() => setThreadMenu(false)}
      onCopy={() => setThreadMenu(false)} onRename={() => setThreadMenu(false)} onArchive={() => setThreadMenu(false)} />
    <button onClick={() => setSkillFixture(true)}>打开 Skill 选择验收</button>
    <button onClick={() => { setOrderFixture(true); setThreadMenu(true); }}>打开菜单顺序验收</button>
    <textarea aria-label="剪贴板验收" />
    <button onClick={() => setSidebar(true)}>打开侧栏验收</button>
    <button onClick={() => {
      document.documentElement.style.setProperty("--app-font-scale", "1.25");
      setHistoryFixture(true);
    }}>打开历史编辑定位验收</button>
    {opened && <p>已进入侧栏会话</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<NativeMenuFixture />);
