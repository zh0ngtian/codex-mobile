import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: ["thread-following.spec.ts", "final-answer-push.spec.ts"], timeout: 30_000,
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:4214" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "small-large-text", testMatch: "thread-following.spec.ts", use: { browserName: "chromium", viewport: { width: 375, height: 667 }, reducedMotion: "reduce" } },
    { name: "landscape", testMatch: "thread-following.spec.ts", use: { browserName: "chromium", viewport: { width: 740, height: 375 } } },
  ],
  webServer: { cwd: new URL("../..", import.meta.url).pathname, command: "NODE_ENV=production npm exec vite -- --host 127.0.0.1 --port 4214 --strictPort", url: "http://127.0.0.1:4214", reuseExistingServer: false },
});
