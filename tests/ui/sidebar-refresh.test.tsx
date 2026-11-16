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
    const intervals: { delay: string; effect: string }[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && /(?:^|\.)setInterval$/.test(node.expression.getText(file))) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !(ts.isCallExpression(parent) && parent.expression.getText(file) === 'useEffect')) parent = parent.parent;
        intervals.push({ delay: node.arguments[1]?.getText(file).replace(/[_\s]/g, "") ?? "", effect: parent?.getText(file) ?? '' });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    // Remote 机器目录每分钟检查是独立能力，不恢复原有会话列表/时间轮询。
    for (const interval of intervals.filter(item => ['60000', '60*1000', '1000*60'].includes(item.delay))) {
      expect(interval.effect).toContain('fetchBackendHostInfo');
      expect(interval.effect).toContain("item.gatewayMode === 'remote'");
      expect(interval.effect).not.toMatch(/refreshAllBackends|setThreads|setNow/);
    }
  });
});

it('原生主画布初始不受隐藏网页侧栏状态影响', () => {
  const { result } = renderHook(() => useSidebarRefresh(undefined, false));
  expect(result.current.sidebarOpen).toBe(false);
  act(() => result.current.openSidebar());
  expect(result.current.sidebarOpen).toBe(true);
  expect(result.current.silentRefreshVersion).toBe(1);
});
