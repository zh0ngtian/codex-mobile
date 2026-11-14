import { useLayoutEffect, type RefObject } from "react";

/** 与原生编辑器一致：自然增高至六行，之后在文字区内滚动。 */
export function useComposerAutoSize(ref: RefObject<HTMLTextAreaElement | null>, text: string) {
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      const scrollTop = input.scrollTop;
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
      input.scrollTop = scrollTop;
    };
    resize();
    let width = input.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer?.observe(input);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [ref, text]);
}
