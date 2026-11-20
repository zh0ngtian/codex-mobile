import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});

it('原生主画布初始不受隐藏网页侧栏状态影响', () => {
  const { result } = renderHook(() => useSidebarRefresh(undefined, false));
  expect(result.current.sidebarOpen).toBe(false);
  act(() => result.current.openSidebar());
  expect(result.current.sidebarOpen).toBe(true);
  expect(result.current.silentRefreshVersion).toBe(1);
});
