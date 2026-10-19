import { useEffect, useRef } from 'react';
import { gatewaySidechatClient, type SidechatClient, type SidechatSessions, type SidechatSession } from './sessions';

/** 分支生命周期定时器独立于普通列表刷新；回调始终读取当前工作区。 */
export function useSidechatExpiry(sessions: SidechatSessions, client: () => SidechatClient | null, openedId: () => string, expired: (side: SidechatSession) => void, failed: (error: unknown) => void) {
  const current = useRef({ client, openedId, expired, failed });
  current.current = { client, openedId, expired, failed };
  useEffect(() => {
    const timer = window.setInterval(() => {
      const connection = current.current.client(); if (!connection) return;
      const opened = sessions.get(current.current.openedId());
      void sessions.expire(gatewaySidechatClient(connection)).then(() => {
        if (opened && !sessions.get(opened.id)) current.current.expired(opened);
      }).catch(error => current.current.failed(error));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [sessions]);
}
