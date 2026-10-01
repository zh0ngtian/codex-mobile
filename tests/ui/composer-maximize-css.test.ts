import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("输入框最大化布局", () => {
  it("覆盖可视区域并让文本框占满剩余空间", () => {
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

    expect(wrapRule).toContain("height: 100dvh");
    expect(wrapRule).toContain("display: flex");
    expect(wrapRule).toContain("overflow: hidden");
    expect(composerRule).toContain("flex: 1 1 auto");
    expect(textareaRule).toContain("height: 100%");
    expect(textareaRule).toContain("max-height: none");
  });
});
