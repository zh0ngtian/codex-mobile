import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { useWebInterface } from '../features/web-ui/preference';
import { hasOverlayPresence, subscribeOverlayPresence } from '../ui/overlay-scroll';
import { FONT_SCALES, readFontSize } from '../ui/font-size';
import { isClientForeground } from './foreground';
import { isNativeBridgeEnabled, isNativeUIEnabled, type NativeRuntime } from './runtime';
import type { NativeWebComposerPresentation } from './protocol';

function foreground() { return (window as Window & { __CODEX_NATIVE_ACTIVE__?: boolean }).__CODEX_NATIVE_ACTIVE__ !== false && isClientForeground(); }
export function isNativeWebComposerEnabled() { return isNativeBridgeEnabled() && !isNativeUIEnabled(); }
function subscribeRecovery(callback: () => void) {
  window.addEventListener('codex-mobile-native-recovery', callback);
  return () => window.removeEventListener('codex-mobile-native-recovery', callback);
}
/** 网页拥有整个表单；原生只借用 textarea 的矩形，焦点及选区均绑定挂载 context。 */
export function useNativeWebComposer(runtime: NativeRuntime | null, backendId: string, contextId: string, visible: boolean, blocked: boolean,
  inputRef: RefObject<HTMLTextAreaElement | null>, onState: (focused: boolean, caret: number) => void) {
  const capable = useSyncExternalStore(subscribeRecovery, isNativeWebComposerEnabled, () => false);
  const overlay = useSyncExternalStore(subscribeOverlayPresence, hasOverlayPresence, () => false);
  const enabled = capable && runtime !== null;
  const { modern } = useWebInterface();
  const state = useRef({ focused: false, focusRevision: 0 });
  const observedSelection = useRef<{ contextId: string; text: string; revision: number; start: number; end: number; committed: boolean } | undefined>(undefined);
  const latest = useRef({ visible, blocked: blocked || overlay, bodyFontSize: modern ? 14.2 : 16, onState });
  latest.current = { visible, blocked: blocked || overlay, bodyFontSize: modern ? 14.2 : 16, onState };
  const publishRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!enabled || !input) { runtime?.setWebComposer(backendId, undefined, contextId); return; }
    state.current = { focused: false, focusRevision: 0 };
    observedSelection.current = undefined;
    const focus = input.focus.bind(input), blur = input.blur.bind(input), select = input.setSelectionRange.bind(input);
    let disposed = false;
    const publish = (register = false) => {
      if (disposed || !input.isConnected) return;
      const current = latest.current;
      let selection = observedSelection.current;
      if (selection?.contextId === contextId) {
        if (input.value === selection.text) {
          // React给未聚焦textarea提交value会把光标推到末尾；等对应正文commit后重放原生选区。
          select(selection.start, selection.end);
          selection.committed = true;
        } else if (selection.committed) {
          // 已确认后的外部正文替换使用它自己的选区，不重放上一个正文的观测。
          observedSelection.current = undefined;
          selection = undefined;
        }
      }
      // 布局代理不接收普通Web textarea防自动缩放的16px下限；与原生共用已缩放正文。
      const fontSize = current.bodyFontSize * FONT_SCALES[readFontSize()];
      const lineHeight = fontSize * 1.4;
      input.style.fontSize = `${fontSize}px`;
      input.style.lineHeight = `${lineHeight}px`;
      const bounds = input.getBoundingClientRect();
      const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
      const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      const valid = [rect.x, rect.y, rect.width, rect.height, viewportWidth, viewportHeight].every(Number.isFinite)
        && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && viewportWidth > 0 && viewportHeight > 0
        && rect.x + rect.width <= viewportWidth + 1 && rect.y + rect.height <= viewportHeight + 1;
      const style = getComputedStyle(input);
      const metric = (name: string, fallback = 0) => { const value = parseFloat(style.getPropertyValue(name)); return Number.isFinite(value) && value >= 0 && value <= 128 ? value : fallback; };
      const value: NativeWebComposerPresentation = { contextId, visible: current.visible, blocked: current.blocked || input.disabled || !foreground(), bodyFontSize: current.bodyFontSize,
        ...(valid ? { rect, viewportWidth, viewportHeight } : {}), focused: state.current.focused, focusRevision: state.current.focusRevision,
        selectionStart: selection?.start ?? input.selectionStart, selectionEnd: selection?.end ?? input.selectionEnd,
        paddingTop: metric('padding-top'), paddingRight: metric('padding-right'), paddingBottom: metric('padding-bottom'), paddingLeft: metric('padding-left'),
        fontSize, lineHeight };
      runtime.setWebComposer(backendId, value, register ? undefined : contextId);
    };
    const update = () => publish();
    publishRef.current = update;
    // 现有 Skill/插件/位置和设置回调仍操作同一个 textarea 引用，改为请求常驻原生编辑器。
    input.focus = () => { if (disposed || input.disabled || !latest.current.visible) return; state.current.focused = true; state.current.focusRevision++; latest.current.onState(true, input.selectionStart); publish(); };
    input.blur = () => { state.current.focused = false; state.current.focusRevision++; latest.current.onState(false, input.selectionStart); publish(); };
    input.setSelectionRange = (start, end, direction) => {
      select(start, end, direction);
      observedSelection.current = { contextId, text: input.value, revision: runtime.snapshot().draftRevision ?? 0, start: input.selectionStart, end: input.selectionEnd, committed: true };
      state.current.focusRevision++;
      publish();
    };
    const editorState = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const snapshot = runtime.snapshot();
      const revision = detail?.draftRevision ?? snapshot.draftRevision ?? 0;
      if (!latest.current.visible || latest.current.blocked || input.disabled || !foreground() || detail?.contextId !== contextId || snapshot.contextId !== contextId || typeof detail.focused !== 'boolean'
        || !Number.isSafeInteger(revision) || revision < 0 || revision !== (snapshot.draftRevision ?? 0)
        || !Number.isSafeInteger(detail.selectionStart) || !Number.isSafeInteger(detail.selectionEnd) || detail.selectionStart < 0 || detail.selectionEnd < detail.selectionStart || detail.selectionEnd > snapshot.draft.length) return;
      observedSelection.current = { contextId, text: snapshot.draft, revision, start: detail.selectionStart, end: detail.selectionEnd, committed: false };
      state.current.focused = detail.focused;
      latest.current.onState(detail.focused, detail.selectionStart);
      publish();
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(input);
    window.addEventListener('codex-mobile-native-editor-state', editorState);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    window.addEventListener('visibilitychange', update);
    window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
    publish(true);
    return () => {
      disposed = true; observer?.disconnect(); input.style.removeProperty('font-size'); input.style.removeProperty('line-height'); input.focus = focus; input.blur = blur; input.setSelectionRange = select;
      window.removeEventListener('codex-mobile-native-editor-state', editorState);
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.removeEventListener('visibilitychange', update);
      window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update);
      runtime.setWebComposer(backendId, undefined, contextId);
    };
  }, [enabled, runtime, backendId, contextId, inputRef]);
  useLayoutEffect(() => { if (!visible) state.current.focused = false; publishRef.current(); });
  return { enabled, isFocused: () => state.current.focused };
}
