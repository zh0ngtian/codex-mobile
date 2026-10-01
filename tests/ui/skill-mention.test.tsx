import { createRef, useState } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InstalledSkill } from "../../src/app-server/skills";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";

const skills: InstalledSkill[] = [
  {
    name: "pdf",
    description: "Read and create PDF files",
    path: "/skills/pdf/SKILL.md",
    scope: "user",
    enabled: true,
  },
  {
    name: "skill-creator",
    description: "Create or update a Codex skill",
    path: "/skills/skill-creator/SKILL.md",
    scope: "system",
    enabled: true,
    interface: {
      displayName: "Skill Creator",
      shortDescription: "Build reusable skills",
    },
  },
];

function SkillComposer({ loading = false }: { loading?: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <ConversationPage
      active={{
        id: "thread-1",
        cwd: "/tmp/project",
        preview: "Skill 会话",
        turns: [],
      }}
      backendId="mini"
      backendName="Mac mini"
      backends={[]}
      projectOptions={[]}
      loadState="ready"
      loadError=""
      olderTurnsState="exhausted"
      connection="online"
      client={null}
      error=""
      draft={draft}
      draftImages={[]}
      draftFiles={[]}
      imageReading={false}
      busy={false}
      steering={false}
      steerable
      pendingSteerText=""
      queuedFollowUps={[]}
      accessMode="interactive"
      resumeError=""
      tokenUsage={null}
      rateLimits={null}
      pendingAction=""
      selectedServiceTier={null}
      selectedModelLabel="Codex"
      selectedEffort={null}
      selectedPermissionLabel="工作区"
      skills={skills}
      skillsLoading={loading}
      imageInputRef={createRef<HTMLInputElement>()}
      onBack={() => undefined}
      onNewChatBackendChange={() => undefined}
      onNewChatProjectChange={() => undefined}
      onPin={async () => true}
      onDuplicate={async () => true}
      onRename={async () => true}
      onArchive={async () => true}
      onRetry={() => undefined}
      onLoadOlderTurns={async () => true}
      onSubmit={(event) => event.preventDefault()}
      onRemoveImage={() => undefined}
      onRemoveFile={() => undefined}
      onSelectImages={async () => undefined}
      onOpenAgentSettings={() => undefined}
      onOpenPermissionSettings={() => undefined}
      onDraftChange={setDraft}
      onInterrupt={() => undefined}
      onQueuedFollowUpAction={() => undefined}
    />
  );
}

describe("输入框 Skill 选择器", () => {
  it("输入 @ 后过滤已安装 Skill，并写入标准调用标记", () => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });

    fireEvent.change(input, { target: { value: "请用 @creator" } });

    const list = view.getByRole("listbox", { name: "已安装 Skill" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("option"));

    expect((input as HTMLTextAreaElement).value).toBe(
      "请用 $skill-creator ",
    );
    expect(view.queryByRole("listbox", { name: "已安装 Skill" })).toBeNull();
  });

  it("支持键盘切换并选择 Skill", () => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });

    fireEvent.change(input, { target: { value: "@" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect((input as HTMLTextAreaElement).value).toBe("$skill-creator ");
  });

  it("Skill 尚在加载时显示局部加载状态", () => {
    const { container } = render(<SkillComposer loading />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });

    fireEvent.change(input, { target: { value: "@" } });

    expect(view.getByRole("status").textContent).toContain("正在加载 Skill");
  });
});
