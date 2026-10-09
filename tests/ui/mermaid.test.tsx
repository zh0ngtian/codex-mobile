import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "../../src/ui/conversation";

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: engine }));

const fenced = (source: string, language = "mermaid") => `\`\`\`${language}\n${source}\n\`\`\``;
const svg = (label: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>` });

beforeEach(() => {
  engine.render.mockReset().mockImplementation(async (_id, source) => svg(source));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Markdown Mermaid 图表", () => {
  it("将 Mermaid 围栏渲染为图表并保留源码复制和查看", async () => {
    const source = "graph TD\n  A[开始] --> B[完成]";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<MarkdownMessage text={fenced(source)} />);
    const diagram = await screen.findByRole("img", { name: "Mermaid 图表" });
    expect(diagram.querySelector("svg")?.textContent).toContain("开始");
    fireEvent.click(screen.getByRole("button", { name: "复制代码块" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
    fireEvent.click(screen.getByRole("button", { name: "查看源码" }));
    expect(document.querySelector("pre code")?.textContent).toBe(source);
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(screen.getByRole("img", { name: "Mermaid 图表" })).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("语言标记不区分大小写，普通代码与行内代码不触发图表渲染", async () => {
    const { rerender, container } = render(<MarkdownMessage text={"`mermaid`\n\n" + fenced("graph TD; A-->B", "ts")} />);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(engine.render).not.toHaveBeenCalled();
    expect(container.querySelector("pre code")?.textContent).toContain("graph TD");
    rerender(<MarkdownMessage text={fenced("graph TD; A-->B", "Mermaid")} />);
    await screen.findByRole("img", { name: "Mermaid 图表" });
  });

  it("非法或尚未完整的源码回退到可复制代码，补全后恢复图表", async () => {
    engine.render.mockRejectedValueOnce(new Error("Parse error"));
    const { rerender } = render(<MarkdownMessage text={fenced("graph TD; A-->")} />);
    await screen.findByText("图表暂时无法渲染，显示源码");
    expect(screen.getByText("graph TD; A-->")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<MarkdownMessage text={fenced("graph TD; A-->B")} />);
    await screen.findByRole("img", { name: "Mermaid 图表" });
    expect(screen.queryByText("图表暂时无法渲染，显示源码")).toBeNull();
  });

  it("流式源码更新后忽略过期异步结果，轮询重绘不重复渲染", async () => {
    let finishOld!: (result: ReturnType<typeof svg>) => void;
    engine.render.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const { rerender } = render(<MarkdownMessage text={fenced("graph TD; A-->Old")} />);
    await waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    rerender(<MarkdownMessage text={fenced("graph TD; A-->New")} />);
    await screen.findByRole("img", { name: "Mermaid 图表" });
    finishOld(svg("Old"));
    await waitFor(() => expect(screen.getByRole("img").textContent).toContain("New"));
    expect(screen.getByRole("img").textContent).not.toContain("Old");
    rerender(<MarkdownMessage text={fenced("graph TD; A-->New")} />);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it("同页多个图表使用不同标识且卸载后清理临时容器", async () => {
    engine.render.mockImplementation(async (_id, source, container) => {
      container.innerHTML = "<svg data-temporary-diagram></svg>";
      return svg(source);
    });
    const { unmount } = render(<MarkdownMessage text={fenced("graph TD; A-->B") + "\n\n" + fenced("sequenceDiagram\n Alice->>Bob: 你好")} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(new Set(engine.render.mock.calls.map(([id]) => id)).size).toBe(2);
    expect(document.querySelector("[data-temporary-diagram]")).toBeNull();
    unmount();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("卸载取消待执行的渲染", async () => {
    const { unmount } = render(<MarkdownMessage text={fenced("graph TD; A-->B")} />);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(engine.render).not.toHaveBeenCalled();
  });
});
