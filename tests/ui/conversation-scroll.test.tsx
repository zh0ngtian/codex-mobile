import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isConversationNearBottom,
  useConversationAutoScroll,
} from "../../src/features/conversation/conversation-scroll";

function ScrollHarness({
  revision,
  threadId = "thread-1",
  editing = false,
}: {
  revision: number;
  threadId?: string;
  editing?: boolean;
}) {
  const {
    scrollRef,
    contentRef,
    onScroll,
    beginPrependPreservation,
  } = useConversationAutoScroll({
    threadId,
    contentRevision: revision,
    ready: true,
    historyEditMessageId: editing ? "history-user" : undefined,
  });
  return (
    <section className="conversation">
      <div data-testid="scroller" ref={scrollRef} onScroll={onScroll}>
        <div ref={contentRef}>{revision}{editing && <div className="history-message-editor"><textarea /></div>}</div>
      </div>
      <button onClick={beginPrependPreservation}>准备插入旧消息</button>
      <form className="composer-wrap" />
    </section>
  );
}

function setScrollMetrics(
  element: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop,
  }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: { configurable: true, value: scrollTop, writable: true },
  });
}

describe("对话流式滚动跟随", () => {
  it("编辑替代待执行的底部跟随，按键盘与固定输入栏边界定位，并允许取消后恢复跟随", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
      frames.set(++id, callback); return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(frame => { frames.delete(frame); });
    const flush = () => {
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
    };
    const { container, getByTestId, rerender, unmount } = render(<ScrollHarness revision={1} />);
    const scroller = getByTestId("scroller");
    setScrollMetrics(scroller, { scrollHeight: 900, clientHeight: 300, scrollTop: 220 });
    rerender(<ScrollHarness revision={1} editing />);
    vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 100, 300, 300));
    const input = container.querySelector("textarea")!;
    vi.spyOn(input, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 560 - scroller.scrollTop, 250, 96));
    vi.spyOn(container.querySelector(".composer-wrap")!, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 300, 300, 100));
    fireEvent(window, new Event("resize"));
    flush();
    expect(scroller.scrollTop).toBe(448);
    expect(input.getBoundingClientRect().top).toBe(112);
    expect(input.getBoundingClientRect().bottom).toBeLessThan(300);
    rerender(<ScrollHarness revision={2} />);
    flush();
    expect(scroller.scrollTop).toBe(448);
    scroller.scrollTop = 600; fireEvent.scroll(scroller);
    rerender(<ScrollHarness revision={3} />); flush();
    expect(scroller.scrollTop).toBe(900);
    unmount();
    expect(frames.size).toBe(0);
  });

  it("容器尺寸变化产生的位置未变 scroll 事件不能取消底部跟随", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const { getByTestId, rerender, unmount } = render(<ScrollHarness revision={1} />);
    const scroller = getByTestId("scroller");
    setScrollMetrics(scroller, { scrollHeight: 500, clientHeight: 200, scrollTop: 220 });
    fireEvent.scroll(scroller);
    setScrollMetrics(scroller, { scrollHeight: 500, clientHeight: 100, scrollTop: 220 });
    fireEvent.scroll(scroller);
    rerender(<ScrollHarness revision={2} />);
    expect(scroller.scrollTop).toBe(500);
    unmount();
  });
  it("使用 80px 阈值判断是否接近底部", () => {
    expect(
      isConversationNearBottom({
        scrollHeight: 500,
        clientHeight: 200,
        scrollTop: 220,
      }),
    ).toBe(true);
    expect(
      isConversationNearBottom({
        scrollHeight: 500,
        clientHeight: 200,
        scrollTop: 100,
      }),
    ).toBe(false);
  });

  it("内容增长时跟随底部，用户上滑后暂停并可恢复", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { getByTestId, rerender } = render(
      <ScrollHarness revision={1} />,
    );
    const scroller = getByTestId("scroller");
    setScrollMetrics(scroller, {
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 220,
    });

    rerender(<ScrollHarness revision={2} />);
    expect(scroller.scrollTop).toBe(500);

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    rerender(<ScrollHarness revision={3} />);
    expect(scroller.scrollTop).toBe(100);

    scroller.scrollTop = 220;
    fireEvent.scroll(scroller);
    rerender(<ScrollHarness revision={4} />);
    expect(scroller.scrollTop).toBe(500);
  });

  it("向前插入旧消息后用高度差保持当前阅读位置", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { container, rerender } = render(
      <ScrollHarness revision={1} />,
    );
    const view = within(container);
    const scroller = view.getByTestId("scroller");
    setScrollMetrics(scroller, {
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 20,
    });
    fireEvent.scroll(scroller);
    fireEvent.click(view.getByText("准备插入旧消息"));

    setScrollMetrics(scroller, {
      scrollHeight: 700,
      clientHeight: 200,
      scrollTop: 20,
    });
    rerender(<ScrollHarness revision={2} />);

    expect(scroller.scrollTop).toBe(220);
  });
});
