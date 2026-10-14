import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkFileReferences } from "../../src/ui/remark-file-references";

const filename = "附件12 项目合同及保密协议(2)(2).doc";
const path = `/Users/zhongtian/Downloads/${filename}`;
const userText = `# Files mentioned by the user:\n\n## ${filename}: ${path}\n\n## My request:\n检查附件。`;
const answerText = `核对材料：\n\n:codex-file-citation{path="${path}" purpose="source"}`;
const styles = readFileSync("src/styles.css", "utf8");
function renderMarkdown(text: string) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, [remarkFileReferences, {
      parseFileHref: (href: string) => href.startsWith("/Users/")
        ? { path: decodeURIComponent(href), line: null, column: null } : null,
    }]],
    children: text,
  }));
}

for (const scale of [1, 1.3]) {
  test(`文件引用在窄屏保持可读且不溢出（字号 ${scale}）`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(`<!doctype html><html style="--app-font-scale:${scale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body><div class="app-shell"><section class="turn-card" style="margin:20px"><div class="user-bubble"><div class="markdown-body user-markdown">${renderMarkdown(userText)}</div></div><article class="assistant-message"><div class="markdown-body">${renderMarkdown(answerText)}</div></article></section></div></body></html>`);
    const links = page.getByRole("link", { name: filename, exact: true });
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      expect(decodeURIComponent((await link.getAttribute("href"))!)).toBe(path);
    }
    await expect(page.locator("body")).not.toContainText(":codex-file-citation");
    const sizes = await page.evaluate(() => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width);
    await page.screenshot({ path: testInfo.outputPath("file-references.png"), fullPage: true });
  });
}
