import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSheet } from "../../src/ui/ActionSheet";
import { ActionSheetDownload } from "../../src/ui/ActionSheetDownload";

afterEach(cleanup);

describe("ActionSheet", () => {
  function scrollable(element: HTMLElement, top = 50) {
    element.style.overflowY = "auto";
    Object.defineProperties(element, {
      clientHeight: { value: 100, configurable: true },
      scrollHeight: { value: 300, configurable: true },
    });
    element.scrollTop = top;
    return element;
  }

  function move(target: Element, fromY: number, toY: number) {
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", {
      value: [{ clientX: 100, clientY: fromY }],
    });
    const event = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", {
      value: [{ clientX: 100, clientY: toY }],
    });
    act(() => {
      target.dispatchEvent(start);
      target.dispatchEvent(event);
    });
    return event;
  }

  it("拦截遮罩、标题和内容边界的滚动，保留内部可滚动内容", () => {
    const { container } = render(<ActionSheet title="管理设备">设置</ActionSheet>);
    const backdrop = container.querySelector<HTMLElement>(".action-sheet-backdrop")!;
    const body = scrollable(container.querySelector<HTMLElement>(".action-sheet-body")!);
    const header = container.querySelector<HTMLElement>("header")!;
    for (const target of [backdrop, header]) {
      expect(move(target, 100, 50).defaultPrevented).toBe(true);
      expect(fireEvent.wheel(target, { deltaY: 80 })).toBe(false);
    }
    expect(move(body, 100, 50).defaultPrevented).toBe(false);
    expect(fireEvent.wheel(body, { deltaY: 80 })).toBe(true);
    body.scrollTop = 200;
    expect(move(body, 100, 50).defaultPrevented).toBe(true);
    expect(fireEvent.wheel(body, { deltaY: 80 })).toBe(false);
    body.scrollTop = 0;
    expect(move(body, 50, 100).defaultPrevented).toBe(true);
    expect(fireEvent.wheel(body, { deltaY: -80 })).toBe(false);
    expect(move(body, 100, 50).defaultPrevented).toBe(false);
  });

  it("多层弹层只允许顶层滚动，按实际层级处理并在关闭后恢复", () => {
    const { container, rerender } = render(
      <>
        <ActionSheet title="高层" backdropClassName="high">高层内容</ActionSheet>
        <ActionSheet title="低层" backdropClassName="low">低层内容</ActionSheet>
      </>,
    );
    const high = container.querySelector<HTMLElement>(".high")!;
    const low = container.querySelector<HTMLElement>(".low")!;
    high.style.zIndex = "40";
    low.style.zIndex = "22";
    const highBody = scrollable(high.querySelector<HTMLElement>(".action-sheet-body")!);
    const lowBody = scrollable(low.querySelector<HTMLElement>(".action-sheet-body")!);
    expect(move(highBody, 100, 50).defaultPrevented).toBe(false);
    expect(move(lowBody, 100, 50).defaultPrevented).toBe(true);
    expect(fireEvent.wheel(lowBody, { deltaY: 80 })).toBe(false);
    rerender(
      <>
        <ActionSheet open={false} title="高层" backdropClassName="high">高层内容</ActionSheet>
        <ActionSheet title="低层" backdropClassName="low">低层内容</ActionSheet>
      </>,
    );
    expect(move(lowBody, 100, 50).defaultPrevented).toBe(false);
  });

  it("嵌套弹层手势不冒泡到底层操作，关闭末层后恢复原始文档样式", () => {
    document.body.style.setProperty("overflow", "auto", "important");
    const originalPriority = document.body.style.getPropertyPriority("overflow");
    const onPointer = vi.fn();
    const onWheel = vi.fn();
    const { container, rerender, unmount } = render(
      <div onPointerDown={onPointer} onWheel={onWheel}>
        <ActionSheet title="底层">
          <ActionSheet title="顶层">顶层内容</ActionSheet>
        </ActionSheet>
      </div>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    const bottom = scrollable(container.querySelectorAll<HTMLElement>(".action-sheet-body")[0]);
    const content = scrollable(container.querySelectorAll<HTMLElement>(".action-sheet-body")[1]);
    expect(move(bottom, 100, 50).defaultPrevented).toBe(true);
    expect(move(content, 100, 50).defaultPrevented).toBe(false);
    fireEvent.pointerDown(content);
    fireEvent.wheel(content, { deltaY: 80 });
    expect(onPointer).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
    rerender(<ActionSheet title="底层">底层内容</ActionSheet>);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.getPropertyPriority("overflow")).toBe(originalPriority);
    document.body.style.removeProperty("overflow");
  });

  it("相同层级以 DOM 绘制顺序选顶层，不受重新打开的时间影响", () => {
    const content = (open: boolean) => <>
      <ActionSheet open={open} title="前方 DOM">内容</ActionSheet>
      <ActionSheet title="后方 DOM">内容</ActionSheet>
    </>;
    const { container, rerender } = render(content(false));
    rerender(content(true));
    const [lower, upper] = Array.from(container.querySelectorAll<HTMLElement>(".action-sheet-body")).map((element) => scrollable(element));
    expect(move(lower, 100, 50).defaultPrevented).toBe(true);
    expect(move(upper, 100, 50).defaultPrevented).toBe(false);
  });

  it("恢复文档原有 overflow 长属性，关闭低层时继续锁住文档", () => {
    document.documentElement.style.setProperty("overflow-y", "scroll", "important");
    const originalPriority = document.documentElement.style.getPropertyPriority("overflow-y");
    const { rerender, unmount } = render(
      <><ActionSheet title="低层">内容</ActionSheet><ActionSheet title="高层">内容</ActionSheet></>,
    );
    rerender(
      <><ActionSheet open={false} title="低层">内容</ActionSheet><ActionSheet title="高层">内容</ActionSheet></>,
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflowY).toBe("scroll");
    expect(document.documentElement.style.getPropertyPriority("overflow-y")).toBe(originalPriority);
    document.documentElement.style.removeProperty("overflow-y");
  });

  it("统一渲染遮罩、固定头部、滚动内容和固定底部", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionSheet
        open
        title="命令执行"
        closeLabel="关闭命令执行"
        footer={<button type="button">完成</button>}
        onClose={onClose}
      >
        <p>详情内容</p>
      </ActionSheet>,
    );

    expect(
      screen.getByRole("dialog", { name: "命令执行" }),
    ).not.toBeNull();
    expect(container.querySelector(".action-sheet-backdrop")).not.toBeNull();
    expect(container.querySelector(".action-sheet-header")).not.toBeNull();
    expect(container.querySelector(".action-sheet-body")?.textContent).toBe(
      "详情内容",
    );
    expect(container.querySelector(".action-sheet-footer")).not.toBeNull();

    fireEvent.click(screen.getByText("详情内容"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("关闭命令执行"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭，并允许业务提供右侧操作", () => {
    const onClose = vi.fn();
    const onDownload = vi.fn();
    const { container } = render(
      <ActionSheet
        open
        title="远程文件"
        onClose={onClose}
        headerActions={
          <button type="button" onClick={onDownload}>
            下载
          </button>
        }
      >
        文件内容
      </ActionSheet>,
    );
    const view = within(container);

    expect(view.getByRole("button", { name: "关闭" }).textContent).toBe("×");
    fireEvent.click(view.getByRole("button", { name: "下载" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(
      container.querySelector(".action-sheet-backdrop") as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开后管理焦点、循环 Tab、响应 Escape 并恢复触发元素", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开";
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { container, unmount } = render(
      <ActionSheet
        open
        title="状态"
        onClose={onClose}
        footer={<button type="button">完成</button>}
      >
        <button type="button">内容操作</button>
      </ActionSheet>,
    );

    const view = within(container);
    const close = view.getByRole("button", { name: "关闭" });
    const complete = view.getByRole("button", { name: "完成" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(complete);
    fireEvent.keyDown(complete, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("不可通过遮罩关闭时也禁用 Escape", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionSheet
        open
        title="审批"
        onClose={onClose}
        closeOnBackdrop={false}
      >
        审批内容
      </ActionSheet>,
    );

    fireEvent.keyDown(screen.getByRole("dialog", { name: "审批" }), {
      key: "Escape",
    });
    fireEvent.click(
      container.querySelector(".action-sheet-backdrop") as HTMLElement,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("关闭状态不渲染", () => {
    const { container } = render(
      <ActionSheet open={false} title="状态">
        不应展示
      </ActionSheet>,
    );

    expect(container.childElementCount).toBe(0);
  });

  it("图片和远程文件复用同一个下载操作样式", () => {
    const { rerender } = render(
      <ActionSheetDownload
        href="data:image/png;base64,AA=="
        filename="preview.png"
        label="下载图片"
      />,
    );
    const imageDownload = screen.getByRole("link", { name: "下载图片" });
    expect(imageDownload.className).toBe("action-sheet-download");
    expect(imageDownload.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 24 24",
    );

    rerender(
      <ActionSheetDownload
        href="data:text/plain;base64,QQ=="
        filename="file.txt"
        label="下载文件"
      />,
    );
    expect(
      screen.getByRole("link", { name: "下载文件" }).className,
    ).toBe(imageDownload.className);
  });
});
