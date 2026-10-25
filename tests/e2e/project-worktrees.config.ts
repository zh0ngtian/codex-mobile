import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "project-worktrees.spec.ts", timeout: 30_000,
  use: { browserName: "chromium", viewport: { width: 402, height: 874 }, baseURL: "http://127.0.0.1:4289" },
  webServer: { cwd: new URL("../..", import.meta.url).pathname, command: "NODE_ENV=production npm exec vite -- --host 127.0.0.1 --port 4289 --strictPort", url: "http://127.0.0.1:4289", reuseExistingServer: false },
});
