import { createRef, useState } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InstalledSkill } from "../../src/app-server/skills";
import type { InstalledPlugin } from "../../src/app-server/plugins";
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
  {
    name: "openai-templates:artifact-template-builder-with-a-very-long-name",
    description: "Build a reusable artifact template from a reference",
    path: "/skills/openai-templates/artifact-template-builder/SKILL.md",
    scope: "user",
    enabled: true,
    interface: {
      displayName: "Artifact Template Builder",
      shortDescription: "Build reusable artifact templates",
    },
  },
];

const plugins: InstalledPlugin[] = [
  {
    id: "creative-production@openai-curated",
    name: "creative-production",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    interface: {
      displayName: "Creative Production",
      shortDescription: "Create polished visual assets",
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
      plugins={plugins}
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
      onSelectLocation={async () => false}
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

    const list = view.getByRole("listbox", { name: "已安装 Skill 和插件" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("option"));

    expect((input as HTMLTextAreaElement).value).toBe(
      "请用 $skill-creator ",
    );
    expect(
      view.queryByRole("listbox", { name: "已安装 Skill 和插件" }),
    ).toBeNull();
  });

  it("触摸候选不依赖 WebKit 被取消的兼容 click", () => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });
    fireEvent.change(input, { target: { value: "@pdf" } });
    const option = view.getByRole("option");
    const pointer = (type: string, x = 10, y = 10) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerType: "touch", pointerId: 1, clientX: x, clientY: y });
      fireEvent(option, event);
    };
    pointer("pointerdown");
    pointer("pointerup");
    expect(option.isConnected).toBe(true);
    fireEvent.touchEnd(option);
    expect((input as HTMLTextAreaElement).value).toBe("$pdf ");
  });

  it.each(["pointermove", "pointercancel", "touchmove"])("触摸候选 %s 后不误选", (type) => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });
    fireEvent.change(input, { target: { value: "@pdf" } });
    const option = view.getByRole("option");
    for (const [eventType, y] of [["pointerdown", 10], [type, 40], ["pointerup", 40]] as const) {
      const event = new Event(eventType, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: y, touches: [{ clientX: 10, clientY: y }] });
      fireEvent(option, event);
    }
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    Object.assign(end, { changedTouches: [] });
    fireEvent(option, end);
    expect(end.defaultPrevented).toBe(true);
    expect((input as HTMLTextAreaElement).value).toBe("@pdf");
  });

  it("触摸终点发生位移时即使缺少 move 通知也不误选", () => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });
    fireEvent.change(input, { target: { value: "@pdf" } });
    const option = view.getByRole("option");
    const down = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.assign(down, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent(option, down);
    fireEvent.touchEnd(option, { changedTouches: [{ clientX: 10, clientY: 40 }] });
    expect((input as HTMLTextAreaElement).value).toBe("@pdf");
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

  it("完整渲染较长的 Skill 调用名", () => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });

    fireEvent.change(input, { target: { value: "@artifact" } });

    const option = view.getByRole("option");
    const invocation = within(option).getByTitle(
      "$openai-templates:artifact-template-builder-with-a-very-long-name",
    );
    expect(invocation.textContent).toBe(
      "$openai-templates:artifact-template-builder-with-a-very-long-name",
    );
    expect(within(option).getByText("Artifact Template Builder")).toBeTruthy();
  });

  it("在同一个 @ 选择器中展示并插入已安装插件", () => {
    const { container } = render(<SkillComposer />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });

    fireEvent.change(input, { target: { value: "请用 @production" } });

    const list = view.getByRole("listbox", { name: "已安装 Skill 和插件" });
    const option = within(list).getByRole("option");
    expect(within(option).getByText("@creative-production")).toBeTruthy();
    expect(within(option).getByText("插件")).toBeTruthy();
    fireEvent.click(option);

    expect((input as HTMLTextAreaElement).value).toBe(
      "请用 @creative-production ",
    );
  });

  it("Skill 尚在加载时显示局部加载状态", () => {
    const { container } = render(<SkillComposer loading />);
    const view = within(container);
    const input = view.getByRole("textbox", { name: "向 Codex 提问" });

    fireEvent.change(input, { target: { value: "@" } });

    expect(view.getByRole("status").textContent).toContain("正在加载 Skill");
  });
});
