import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "approval-replies.spec.ts", timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4193", channel: process.env.PLAYWRIGHT_CHANNEL, viewport: { width: 375, height: 812 } },
  webServer: { cwd: new URL("../..", import.meta.url).pathname, command: "npm exec vite -- --host 127.0.0.1 --port 4193 --strictPort", url: "http://127.0.0.1:4193", reuseExistingServer: false },
});
