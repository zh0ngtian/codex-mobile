import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "file-references.spec.ts",
  projects: [
    { name: "webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
});
