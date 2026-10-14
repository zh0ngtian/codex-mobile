import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { useSidebarRefresh } from "../../src/features/threads/sidebar-refresh";

describe("侧边栏刷新", () => {
  it("打开侧边栏触发静默刷新，手动刷新保留可见加载反馈", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => useSidebarRefresh(onRefresh));

    act(() => result.current.openSidebar());
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => result.current.closeSidebar());
    act(() => result.current.openSidebar());
    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.silentRefreshVersion).toBe(1);
    expect(result.current.refreshVersion).toBe(0);

    act(() => result.current.openSidebar());
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => result.current.refresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.silentRefreshVersion).toBe(1);
    expect(result.current.refreshVersion).toBe(1);

    act(() => result.current.refreshSilently());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.silentRefreshVersion).toBe(2);
    expect(result.current.refreshVersion).toBe(1);
  });

  it("应用不再注册每分钟列表或时间刷新", () => {
    const source = readFileSync(resolve("src/App.tsx"), "utf8");

    const file = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const intervalDelays: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && /(?:^|\.)setInterval$/.test(node.expression.getText(file))) {
        intervalDelays.push(node.arguments[1]?.getText(file).replace(/[_\s]/g, "") ?? "");
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    // 托管排队的 2 秒同步允许存在；这里只限制原先的每分钟列表/时间刷新。
    expect(intervalDelays).not.toContain("60000");
    expect(intervalDelays).not.toContain("60*1000");
    expect(intervalDelays).not.toContain("1000*60");
  });
});

it('原生主画布初始不受隐藏网页侧栏状态影响', () => {
  const { result } = renderHook(() => useSidebarRefresh(undefined, false));
  expect(result.current.sidebarOpen).toBe(false);
  act(() => result.current.openSidebar());
  expect(result.current.sidebarOpen).toBe(true);
  expect(result.current.silentRefreshVersion).toBe(1);
});
