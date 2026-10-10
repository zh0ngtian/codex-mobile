import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "history-edit-focus.spec.ts", timeout: 30_000,
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:4198", channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: { cwd: new URL("../..", import.meta.url).pathname, command: "npm exec vite -- --host 127.0.0.1 --port 4198 --strictPort", url: "http://127.0.0.1:4198", reuseExistingServer: false },
});
