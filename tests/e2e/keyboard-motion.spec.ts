import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("拖尾探针能识别仍在运行的真实 WAAPI 动画", async ({ page }) => {
  const source = readFileSync("mobile/ios/KeyboardLayoutProbe.swift", "utf8");
  const script = source.match(/private func finishMeasurement\(\) \{\s*evaluateJavaScript\("""\s*([\s\S]*?)\s*"""\)/)![1];
  await page.setContent('<!doctype html><style>body{margin:0}.composer-wrap{position:fixed;bottom:12px;height:100px;width:300px}</style><form class="composer-wrap"></form>');
  await page.evaluate(async () => {
    const form = document.querySelector<HTMLElement>("form")!;
    form.style.top = "400px";
    form.style.bottom = "auto";
    const animation = form.animate([{ top: "400px" }, { top: "688px" }], { duration: 1000, fill: "forwards" });
    animation.pause(); await animation.ready; animation.currentTime = 200;
  });
  const measured = await page.evaluate<number>(script);
  expect(measured).toBeGreaterThan(200);
  const actual = await page.evaluate(() => {
    const form = document.querySelector<HTMLElement>("form")!;
    const current = form.getBoundingClientRect().top;
    form.getAnimations().forEach((animation) => animation.cancel());
    form.style.top = ""; form.style.bottom = "";
    return Math.abs(current - form.getBoundingClientRect().top);
  });
  expect(measured).toBeCloseTo(actual, 1);
});
