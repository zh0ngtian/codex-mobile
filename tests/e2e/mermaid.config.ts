import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "mermaid.spec.ts",
  timeout: 30_000,
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://127.0.0.1:4175",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "npm exec -- vite --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
  },
});
