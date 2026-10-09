import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "keyboard-motion.spec.ts", workers: 1,
  use: { browserName: "chromium", viewport: { width: 400, height: 800 } } });
