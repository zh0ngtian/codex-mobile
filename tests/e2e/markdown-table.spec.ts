import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const styles = readFileSync("src/styles.css", "utf8");
const commit = "6ec8c3ee57a10d3acf1adbe37a8529756456dfa2";
const sha256 = "2c23e3733937bcf7dfea8a73f835c030e55289afbe579f85aa47bdfbf301540a";
const markdown = renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm],
  children: `正文中的提交 \`${commit}\`。\n\n| Commit | 大小（字节） | SHA-256 |\n|---|---:|---|\n| \`${commit}\` | 4,714,647 | \`${sha256}\` |`,
}));

for (const scale of [1, 1.3]) {
  test(`长标识符表格保留正常字号和横向滚动（字号 ${scale}）`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(`<!doctype html><html style="--app-font-scale:${scale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body><div class="app-shell"><article class="assistant-message" style="margin:20px"><div class="markdown-body">${markdown}</div></article></div></body></html>`);
    const metrics = await page.evaluate(() => {
      const code = document.querySelector("td code")!;
      const reference = document.querySelector("p code")!;
      const table = document.querySelector("table")!;
      const textHeight = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().height;
      };
      return {
        codeHeight: textHeight(code), referenceHeight: textHeight(reference),
        fontSize: parseFloat(getComputedStyle(code).fontSize),
        supportsTextSizeAdjust: CSS.supports("-webkit-text-size-adjust", "100%") || CSS.supports("text-size-adjust", "100%"),
        textSizeAdjust: getComputedStyle(code).getPropertyValue("-webkit-text-size-adjust") || getComputedStyle(code).getPropertyValue("text-size-adjust"),
        tableWidth: table.clientWidth, contentWidth: table.scrollWidth,
        viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
      };
    });
    expect(metrics.codeHeight).toBeLessThanOrEqual(metrics.referenceHeight + 1);
    // macOS WebKit 不提供 iOS 的 text-size-adjust，仍验证实际字号与布局。
    if (metrics.supportsTextSizeAdjust) expect(metrics.textSizeAdjust).toBe("100%");
    expect(metrics.fontSize).toBeCloseTo(16 * scale * 0.88, 1);
    expect(metrics.contentWidth).toBeGreaterThan(metrics.tableWidth);
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    await page.locator("table").evaluate((table) => { table.scrollLeft = table.scrollWidth; });
    expect(await page.locator("table").evaluate((table) => table.scrollLeft)).toBeGreaterThan(0);
  });
}
