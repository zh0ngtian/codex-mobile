import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "overlay-scroll.spec.ts",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4182" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 393, height: 851 } } },
    { name: "webkit", use: { browserName: "webkit", viewport: { width: 393, height: 851 } } },
    { name: "touch", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: "npm exec -- vite --host 127.0.0.1 --port 4182 --strictPort",
    url: "http://127.0.0.1:4182/tests/e2e/fixtures/overlay-scroll.html",
    reuseExistingServer: false,
  },
});
