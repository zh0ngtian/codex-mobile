import {
  type UIEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

export const conversationBottomThreshold = 80;

export function isConversationNearBottom(
  target: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
  threshold = conversationBottomThreshold,
) {
  return (
    target.scrollHeight - target.clientHeight - target.scrollTop <= threshold
  );
}

export function useConversationAutoScroll({
  threadId,
  contentRevision,
  ready,
  historyEditMessageId,
}: {
  threadId: string;
  contentRevision: unknown;
  ready: boolean;
  historyEditMessageId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const prependScrollHeightRef = useRef<number | null>(null);
  const historyEditRef = useRef(historyEditMessageId);
  historyEditRef.current = historyEditMessageId;

  const revealHistoryEditor = useCallback(() => {
    const scroll = scrollRef.current;
    const input = scroll?.querySelector<HTMLTextAreaElement>(".history-message-editor textarea");
    if (!scroll || !input || !historyEditRef.current) return;
    const viewport = window.visualViewport;
    const bounds = scroll.getBoundingClientRect();
    const composer = scroll.closest(".conversation")
      ?.querySelector(".composer-wrap")?.getBoundingClientRect();
    const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 12;
    const bottom = Math.min(
      bounds.bottom,
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
      composer?.top ?? bounds.bottom,
    ) - 12;
    if (bottom <= top) return;
    // 大字号和多行历史原文也不能伸到键盘或固定输入栏后面。
    const inputBounds = input.getBoundingClientRect();
    const panel = input.closest(".history-message-editor")?.getBoundingClientRect();
    const controlsHeight = Math.max(0, (panel?.bottom ?? inputBounds.bottom) - inputBounds.bottom);
    input.style.setProperty("--history-editor-visible-height", `${Math.max(96, bottom - top - controlsHeight)}px`);
    scroll.scrollTop += input.getBoundingClientRect().top - top;
    lastScrollTopRef.current = scroll.scrollTop;
  }, []);

  const scrollToLatest = useCallback(() => {
    const target = scrollRef.current;
    if (!target) return;
    followingRef.current = true;
    target.scrollTop = target.scrollHeight;
    lastScrollTopRef.current = target.scrollTop;
  }, []);

  const scheduleScroll = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      if (historyEditRef.current) revealHistoryEditor();
      else if (followingRef.current) scrollToLatest();
    });
  }, [revealHistoryEditor, scrollToLatest]);

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    if (event.currentTarget.scrollTop === lastScrollTopRef.current) return;
    lastScrollTopRef.current = event.currentTarget.scrollTop;
    const following = isConversationNearBottom(event.currentTarget);
    followingRef.current = !historyEditRef.current && following;
  }, []);

  const beginPrependPreservation = useCallback(() => {
    const target = scrollRef.current;
    if (!target) return;
    followingRef.current = false;
    prependScrollHeightRef.current = target.scrollHeight;
  }, []);

  const cancelPrependPreservation = useCallback(() => {
    prependScrollHeightRef.current = null;
  }, []);

  useLayoutEffect(() => {
    followingRef.current = true;
    prependScrollHeightRef.current = null;
    if (ready) scheduleScroll();
  }, [ready, scheduleScroll, threadId]);

  useLayoutEffect(() => {
    const target = scrollRef.current;
    if (target && prependScrollHeightRef.current != null) {
      const previousScrollHeight = prependScrollHeightRef.current;
      prependScrollHeightRef.current = null;
      target.scrollTop += target.scrollHeight - previousScrollHeight;
      return;
    }
    if (ready && followingRef.current) scheduleScroll();
  }, [contentRevision, ready, scheduleScroll]);

  useLayoutEffect(() => {
    if (!historyEditMessageId) return;
    followingRef.current = false;
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    revealHistoryEditor();
    scheduleScroll();
  }, [historyEditMessageId, threadId, revealHistoryEditor, scheduleScroll]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (historyEditRef.current || followingRef.current) scheduleScroll();
    });
    observer.observe(content);
    if (scrollRef.current) observer.observe(scrollRef.current);
    const composer = scrollRef.current?.closest(".conversation")?.querySelector(".composer-wrap");
    if (composer) observer.observe(composer);
    return () => observer.disconnect();
  }, [scheduleScroll, threadId]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const onViewportChange = () => {
      if (historyEditRef.current) scheduleScroll();
    };
    window.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [scheduleScroll]);

  useEffect(
    () => () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  return {
    scrollRef,
    contentRef,
    onScroll,
    beginPrependPreservation,
    cancelPrependPreservation,
  };
}
