import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "commentary-history.spec.ts", timeout: 30_000,
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:4208" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: { cwd: new URL("../..", import.meta.url).pathname, command: "npm exec vite -- --host 127.0.0.1 --port 4208 --strictPort", url: "http://127.0.0.1:4208", reuseExistingServer: false },
});
