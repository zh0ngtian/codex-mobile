import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("输入框展开布局", () => {
  it("使用半屏面板并让文本框占满剩余空间", () => {
    const wrapRule =
      styles.match(
        /(?:^|\n)\.composer-wrap-maximized\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const composerRule =
      styles.match(
        /(?:^|\n)\.composer-wrap-maximized \.composer\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const textareaRule =
      styles.match(
        /(?:^|\n)\.composer-wrap-maximized \.composer textarea\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(wrapRule).toContain("height: min(52dvh, 520px)");
    expect(wrapRule).toContain(
      "inset: auto auto var(--input-bar-bottom-offset) 50%",
    );
    expect(wrapRule).toContain("padding: 10px 4px");
    expect(wrapRule).toContain("border-radius: 24px 24px 0 0");
    expect(wrapRule).not.toContain("100dvh");
    expect(wrapRule).toContain("display: flex");
    expect(wrapRule).toContain("overflow: hidden");
    expect(composerRule).toContain("flex: 1 1 auto");
    expect(textareaRule).toContain("height: 100%");
    expect(textareaRule).toContain("max-height: none");
  });
});
