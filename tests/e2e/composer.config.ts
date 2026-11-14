import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["composer.spec.ts", "skill-picker.spec.ts", "follow-up-layout.spec.ts", "new-chat-drafts.spec.ts", "model-settings-persistence.spec.ts"],
  timeout: 40_000,
  use: { ...devices["iPhone 17 Pro"], browserName: "webkit", baseURL: "http://127.0.0.1:4199" },
  webServer: {
    cwd: new URL("../..", import.meta.url).pathname,
    command: "npm exec vite -- --host 127.0.0.1 --port 4199 --strictPort",
    url: "http://127.0.0.1:4199", reuseExistingServer: false,
  },
});
