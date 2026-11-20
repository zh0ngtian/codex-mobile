import { useCallback, useEffect, useRef, useState } from "react";
import { isClientForeground } from "../../native-ui/foreground";

export function useSidebarRefresh(onRefresh?: () => void, initiallyOpen = true) {
  const [sidebarOpen, setSidebarOpen] = useState(initiallyOpen);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [silentRefreshVersion, setSilentRefreshVersion] = useState(0);
  const sidebarOpenRef = useRef(initiallyOpen);

  const refresh = useCallback(() => {
    onRefresh?.();
    setRefreshVersion((current) => current + 1);
  }, [onRefresh]);

  const refreshSilently = useCallback(() => {
    setSilentRefreshVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isClientForeground()) refreshSilently();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshSilently]);

  const openSidebar = useCallback(() => {
    if (sidebarOpenRef.current) return;
    sidebarOpenRef.current = true;
    setSidebarOpen(true);
    refreshSilently();
  }, [refreshSilently]);

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
    refreshSilently,
  };
}
