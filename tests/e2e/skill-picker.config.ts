import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "skill-picker.spec.ts", timeout: 20_000,
  use: { baseURL: "http://127.0.0.1:4201", hasTouch: true },
  projects: [
    { name: "chromium-mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: {
    cwd: new URL("../..", import.meta.url).pathname,
    command: "npm exec vite -- --host 127.0.0.1 --port 4201 --strictPort",
    url: "http://127.0.0.1:4201", reuseExistingServer: false,
  },
});
