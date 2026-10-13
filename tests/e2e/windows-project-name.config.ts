import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "windows-project-name.spec.ts",
  timeout: 30_000,
  use: {
    ...devices["Pixel 7"],
    channel: "chrome",
    baseURL: "http://127.0.0.1:4187",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: "npm exec -- vite --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
  },
});
