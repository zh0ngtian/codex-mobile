import { createRef, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import { contextRemainingPercent, formatTokenCount, rateLimitRemainingPercent } from "../../src/features/conversation/usage-metrics";

const preference = vi.hoisted(() => ({ modern: false }));
vi.mock("../../src/features/web-ui/preference", () => ({ useWebInterface: () => preference }));
afterEach(cleanup);

const tokenUsage = {
  last: { totalTokens: 100_000 },
  total: { totalTokens: 3_084_000 },
  modelContextWindow: 250_000,
};
const rateLimits = {
  rateLimits: {
    primary: { usedPercent: 29, windowDurationMins: 10_080 },
    secondary: { usedPercent: 15, windowDurationMins: 300 },
  },
};

function pageProps(overrides: Partial<ComponentProps<typeof ConversationPage>> = {}): ComponentProps<typeof ConversationPage> {
  return {
    active: { id: "thread-1", cwd: "/tmp/project", preview: "测试对话", turns: [] },
    backendId: "mini", backendName: "Mac mini", backends: [], projectOptions: [],
    loadState: "ready", loadError: "", olderTurnsState: "exhausted", connection: "online",
    client: null, error: "", draft: "", draftImages: [], draftFiles: [], imageReading: false,
    busy: false, steering: false, steerable: true, pendingSteerText: "", queuedFollowUps: [],
    accessMode: "interactive", resumeError: "", tokenUsage, rateLimits, pendingAction: "",
    selectedServiceTier: null, selectedModelLabel: "Codex", selectedEffort: null, selectedPermissionLabel: "工作区",
    imageInputRef: createRef<HTMLInputElement>(), onBack: () => undefined,
    onNewChatBackendChange: () => undefined, onNewChatProjectChange: () => undefined,
    onPin: async () => true, onDuplicate: async () => true, onRename: async () => true,
    onArchive: async () => true, onRetry: () => undefined, onLoadOlderTurns: async () => true,
    onSubmit: () => undefined, onRemoveImage: () => undefined, onRemoveFile: () => undefined,
    onSelectImages: async () => undefined, onSelectLocation: async () => false,
    onOpenAgentSettings: () => undefined, onOpenPermissionSettings: () => undefined,
    onDraftChange: () => undefined, onInterrupt: () => undefined, onQueuedFollowUpAction: () => undefined,
    ...overrides,
  };
}

function openCard() {
  const button = screen.getByRole("button", { name: "查看上下文占用情况" });
  fireEvent.click(button);
  return { button, card: screen.getByRole("dialog", { name: "用量与额度" }) };
}

describe("对话用量计算", () => {
  it.each([
    [0, "0"], [950, "950"], [1_000, "1K"], [1_050, "1.1K"],
    [128_450, "128.5K"], [999_999, "1M"], [1_000_000, "1M"], [3_084_000, "3.1M"],
  ])("%s Token 按十进制显示为 %s", (value, expected) => {
    expect(formatTokenCount(value)).toBe(expected);
  });

  it.each([null, undefined, -1, NaN, Infinity, "1000"])("无效 Token %s 不生成数值", (value) => {
    expect(formatTokenCount(value)).toBeNull();
  });

  it("上下文只取最近一次用量，累计 token 不参与计算", () => {
    expect(contextRemainingPercent(tokenUsage)).toBe(60);
    expect(contextRemainingPercent({ ...tokenUsage, last: null })).toBeNull();
  });

  it.each([null, undefined, -1, NaN])("无效最近用量 %s 不伪造 0%%", (value) => {
    expect(contextRemainingPercent({ ...tokenUsage, last: { totalTokens: value } })).toBeNull();
  });

  it.each([null, undefined, 0, -1, NaN])("无效上下文窗口 %s 显示无数据", (value) => {
    expect(contextRemainingPercent({ ...tokenUsage, modelContextWindow: value })).toBeNull();
  });

  it("按窗口时长区分七天和五小时，兼容包装与原始结构及倒置位置", () => {
    const remaining = rateLimitRemainingPercent;
    expect(remaining(rateLimits, 10_080)).toBe(71);
    expect(remaining(rateLimits, 300)).toBe(85);
    expect(remaining({ primary: rateLimits.rateLimits.secondary, secondary: rateLimits.rateLimits.primary }, 10_080)).toBe(71);
    expect(remaining({ primary: rateLimits.rateLimits.secondary, secondary: rateLimits.rateLimits.primary }, 300)).toBe(85);
  });

  it.each([null, undefined, -1, NaN])("额度用量 %s 无效时不伪造剩余百分比", (value) => {
    expect(rateLimitRemainingPercent({ primary: { usedPercent: value, windowDurationMins: 300 } }, 300)).toBeNull();
  });

  it.each([null, undefined, -1, NaN, 0, 301, 20_160])("无效或不匹配窗口 %s 不按位置猜测", (duration) => {
    expect(rateLimitRemainingPercent({ primary: { usedPercent: 20, windowDurationMins: duration } }, 300)).toBeNull();
    expect(rateLimitRemainingPercent({ secondary: { usedPercent: 20, windowDurationMins: duration } }, 10_080)).toBeNull();
  });

  it("百分比保留整数，并为超额用量显示零余量", () => {
    expect(contextRemainingPercent({ ...tokenUsage, last: { totalTokens: 100_999 } })).toBe(60);
    expect(contextRemainingPercent({ ...tokenUsage, last: { totalTokens: 300_000 } })).toBe(0);
    expect(rateLimitRemainingPercent({ primary: { usedPercent: 29.4, windowDurationMins: 300 } }, 300)).toBe(71);
  });
});

describe.each([false, true])("对话用量卡片（现代界面 %s）", (modern) => {
  beforeEach(() => { preference.modern = modern; });
  it("顶部按钮打开四行卡片，移除线程 ID、目录和重置时间", () => {
    const { container } = render(<ConversationPage {...pageProps()} />);
    const { card, button } = openCard();
    const view = within(card);
    for (const [label, value] of [["上下文余量", "60%"], ["周期剩余", "71%"], ["时间剩余", "85%"], ["对话 Token", "3.1M"]]) {
      expect(view.getByText(label).nextElementSibling?.textContent).toBe(value);
    }
    expect(card.parentElement).toBe(document.body);
    expect(container).not.toContainElement(card);
    expect(card).not.toHaveTextContent("thread-1");
    expect(card).not.toHaveTextContent("/tmp/project");
    expect(card).not.toHaveTextContent("重置");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("卡片跟随实时 props 更新，累计 total 缺失时不回退 last", () => {
    const { rerender } = render(<ConversationPage {...pageProps()} />);
    const { card } = openCard();
    rerender(<ConversationPage {...pageProps({ tokenUsage: { ...tokenUsage, last: { totalTokens: 125_000 }, total: { totalTokens: 128_450 } }, rateLimits: { primary: { usedPercent: 45, windowDurationMins: 300 }, secondary: { usedPercent: 65, windowDurationMins: 10_080 } } })} />);
    expect(within(card).getByText("上下文余量").nextElementSibling).toHaveTextContent("50%");
    expect(within(card).getByText("周期剩余").nextElementSibling).toHaveTextContent("35%");
    expect(within(card).getByText("时间剩余").nextElementSibling).toHaveTextContent("55%");
    expect(within(card).getByText("对话 Token").nextElementSibling).toHaveTextContent("128.5K");
    rerender(<ConversationPage {...pageProps({ tokenUsage: { ...tokenUsage, total: null } })} />);
    expect(within(card).getByText("对话 Token").nextElementSibling).toHaveTextContent("暂无数据");
  });

  it("历史用量缺失时四行均显示暂无数据", () => {
    render(<ConversationPage {...pageProps({ tokenUsage: null, rateLimits: null })} />);
    expect(within(openCard().card).getAllByText("暂无数据")).toHaveLength(4);
  });

  it.each(["Escape", "外部点击", "再次点击"])("%s 关闭卡片并恢复触发按钮焦点", (method) => {
    render(<ConversationPage {...pageProps()} />);
    const { card, button } = openCard();
    card.focus();
    if (method === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else if (method === "外部点击") fireEvent.pointerDown(document.body);
    else {
      fireEvent.pointerDown(button);
      fireEvent.click(button);
    }
    expect(screen.queryByRole("dialog", { name: "用量与额度" })).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("卡片内部点击保持打开", () => {
    render(<ConversationPage {...pageProps()} />);
    const { card } = openCard();
    fireEvent.pointerDown(within(card).getByText("对话 Token"));
    fireEvent.click(within(card).getByText("对话 Token"));
    expect(card).toBeInTheDocument();
  });

  it.each(["thread", "backend"])("切换 %s 时关闭卡片，避免串用量", (change) => {
    const { rerender } = render(<ConversationPage {...pageProps()} />);
    openCard();
    rerender(<ConversationPage {...pageProps(change === "thread" ? { active: { id: "thread-2", turns: [] }, tokenUsage: null } : { backendId: "other" })} />);
    expect(screen.queryByRole("dialog", { name: "用量与额度" })).toBeNull();
  });
});
