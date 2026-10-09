import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "web-ui.spec.ts", timeout: 30_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", viewport: { width: 375, height: 812 } },
  webServer: { cwd: fileURLToPath(new URL("../../", import.meta.url)), command: "npm exec vite -- --host 127.0.0.1 --port 4174 --strictPort", url: "http://127.0.0.1:4174", reuseExistingServer: false },
});
