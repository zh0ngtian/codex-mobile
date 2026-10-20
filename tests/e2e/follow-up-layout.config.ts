import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "follow-up-layout.spec.ts", timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4199" },
  projects: [
    { name: "chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: { cwd: new URL("../..", import.meta.url).pathname, command: "npm exec vite -- --host 127.0.0.1 --port 4199 --strictPort", url: "http://127.0.0.1:4199", reuseExistingServer: false },
});
