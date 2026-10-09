import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "ios-spinner.spec.ts",
  projects: [
    { name: "ios-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "android-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
});
