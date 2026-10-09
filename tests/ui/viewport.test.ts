import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("页面缩放约束", () => {
  it("允许辅助阅读缩放，同时保留全面屏安全区域适配", () => {
    const viewport =
      html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)?.[1] ?? "";

    expect(viewport).toContain("width=device-width");
    expect(viewport).toContain("initial-scale=1");
    expect(viewport).not.toContain("maximum-scale=1");
    expect(viewport).not.toContain("user-scalable=no");
    expect(viewport).toContain("viewport-fit=cover");
  });

  it("页面允许平移滚动与双指辅助缩放", () => {
    const pageRule =
      styles.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(pageRule).toContain("touch-action: pan-x pan-y pinch-zoom");
  });
});
