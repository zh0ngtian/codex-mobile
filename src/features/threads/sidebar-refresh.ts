import { useCallback, useRef, useState } from "react";

export function useSidebarRefresh(onRefresh: () => void) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [silentRefreshVersion, setSilentRefreshVersion] = useState(0);
  const sidebarOpenRef = useRef(true);

  const refresh = useCallback(() => {
    onRefresh();
    setRefreshVersion((current) => current + 1);
  }, [onRefresh]);

  const openSidebar = useCallback(() => {
    if (sidebarOpenRef.current) return;
    sidebarOpenRef.current = true;
    setSidebarOpen(true);
    setSilentRefreshVersion((current) => current + 1);
  }, []);

  const closeSidebar = useCallback(() => {
    if (!sidebarOpenRef.current) return;
    sidebarOpenRef.current = false;
    setSidebarOpen(false);
  }, []);

  return {
    sidebarOpen,
    refreshVersion,
    silentRefreshVersion,
    openSidebar,
    closeSidebar,
    refresh,
  };
}
