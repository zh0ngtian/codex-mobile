import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TurnCard } from "../../../src/features/conversation/Timeline";
import { ConversationActionMenu } from "../../../src/features/conversation/ConversationControls";
import "../../../src/styles.css";

function NativeMenuFixture() {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("原生菜单验收消息");
  const [threadMenu, setThreadMenu] = useState(false);
  const [pinned, setPinned] = useState(false);
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
  </main>;
}
createRoot(document.getElementById("root")!).render(<NativeMenuFixture />);
