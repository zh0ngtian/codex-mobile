import React, { createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationPage } from "../../../src/features/conversation/ConversationPage";
import "../../../src/styles.css";
localStorage.setItem("codex-mobile:language", "zh-CN");
function ConversationUsageFixture() {
  const [draft, setDraft] = useState("");
  const rawTokens = new URLSearchParams(window.location.search).get("tokens");
  const noData = rawTokens === "none";
  const tokenUsage = noData ? null : {
    total: {
      totalTokens: rawTokens === "3084000" ? 3_084_000 : 128_450,
      inputTokens: rawTokens === "3084000" ? 3_000_000 : 100_000,
      cachedInputTokens: rawTokens === "3084000" ? 2_400_000 : 80_000,
      outputTokens: rawTokens === "3084000" ? 84_000 : 28_450,
    },
    last: { totalTokens: 17_500 }, modelContextWindow: 250_000,
  };
  const rateLimits = noData ? null : { rateLimits: {
    primary: { usedPercent: 57, windowDurationMins: 300 },
    secondary: { usedPercent: 28, windowDurationMins: 10_080 },
  } };
  return <ConversationPage
    active={{ id: "usage-fixture", cwd: "/fixture", preview: "对话用量验收", turns: [{ id: "fixture-turn", status: "completed", items: [{ id: "fixture-user", type: "userMessage", text: "查看当前对话的用量与额度" }, { id: "fixture-answer", type: "agentMessage", phase: "final_answer", text: "点击右上角的圆圈，查看上下文、额度和对话累计 Token。" }] }] }}
    conversationVisible backendId="fixture" backendName="验收设备" backends={[]} projectOptions={[]}
    loadState="ready" loadError="" olderTurnsState="exhausted" connection="online" client={null}
    error="" draft={draft} draftImages={[]} draftFiles={[]} imageReading={false}
    busy={false} steering={false} steerable pendingSteerText="" queuedFollowUps={[]}
    accessMode="interactive" resumeError="" tokenUsage={tokenUsage} rateLimits={rateLimits} pendingAction=""
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

createRoot(document.getElementById("root")!).render(<ConversationUsageFixture />);
