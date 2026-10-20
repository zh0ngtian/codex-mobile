import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const styles = readFileSync("src/styles.css", "utf8");
const token = "abcdefghijklmnop";
const markdown = renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm],
  children: `Text before \`${token}\` end\n\nText before ${token} end\n\n\`\`\`text\n${token.repeat(8)}\n\`\`\``,
}));

test("行内代码利用剩余行宽，正文单词与代码块保留原排版", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body><article class="assistant-message" style="width:200px"><div class="markdown-body">${markdown}</div></article></body></html>`);
  const metrics = await page.evaluate(() => {
    const paragraphs = document.querySelectorAll("p");
    const code = paragraphs[0].querySelector("code")!;
    const top = (node: Node, start: number, end: number) => {
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, end);
      return range.getBoundingClientRect().top;
    };
    const plain = paragraphs[1].firstChild!;
    const block = document.querySelector("pre code")!;
    return {
      prefixTop: top(paragraphs[0].firstChild!, 0, 4),
      codeStartTop: top(code.firstChild!, 0, 1),
      codeEndTop: top(code.firstChild!, 15, 16),
      plainStartTop: top(plain, 12, 13), plainEndTop: top(plain, 27, 28),
      text: code.textContent, blockText: block.textContent,
      blockHeight: block.getBoundingClientRect().height,
      blockStyle: getComputedStyle(block).whiteSpace,
    };
  });
  expect(metrics.codeStartTop).toBeLessThan(metrics.prefixTop + 5);
  expect(metrics.codeEndTop).toBeGreaterThan(metrics.codeStartTop + 5);
  expect(metrics.plainEndTop).toBeCloseTo(metrics.plainStartTop, 1);
  expect(metrics.text).toBe(token);
  expect(metrics.blockText).toBe(token.repeat(8) + "\n");
  expect(metrics.blockStyle).toBe("pre");
});
