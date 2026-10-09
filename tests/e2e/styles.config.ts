import { defineConfig, devices } from "@playwright/test";

// 字体渲染验证只需要真实样式，不依赖网关或 Codex 进程。
export default defineConfig({
  testDir: ".",
  testMatch: "ios-bold-text.spec.ts",
  use: { ...devices["Pixel 7"], channel: undefined },
});
