import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { it, expect } from "vitest";

it("签名启用时未签名 IPA 后必须签名，发布凭据只来自 Secrets", () => {
  const ios = parse(readFileSync(".github/workflows/build-ios.yml", "utf8"));
  const sign = ios.jobs.build.steps.find((step: any) => step.name === "Sign Ad Hoc IPA");
  expect(sign).toBeDefined();
  expect(sign.if).toContain("IOS_ADHOC_ENABLED");
  expect(sign.run).toContain("scripts/ios_sign.py");
  expect(sign.env.P12_PASSWORD).toContain("secrets.IOS_P12_PASSWORD");
  const ota = ios.jobs.build.steps.find((step: any) => step.name === "Publish HTTPS OTA");
  expect(ota).toBeDefined();
  expect(ota.run).toContain("scripts/ios_ota.py");
  const parent = parse(readFileSync(".github/workflows/build-android.yml", "utf8"));
  expect(parent.jobs.ios.secrets).toBe("inherit");
});

it("主版本流水线包含本机先发布的更高 OTA 版本", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "codex-ota-version-"));
  try {
    const floor = JSON.parse(readFileSync("mobile-version-floor.json", "utf8")).version;
    const otaMajor = Number(floor.split(".")[0]) + 1;
    const otaVersion = `${otaMajor}.0.0`;
    for (const [name, body] of [["gh", "printf 'v0.2.16\\n'"], ["python3", `printf '${otaVersion}\\n'`]]) {
      const path = join(directory, name); writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755);
    }
    const workflow = parse(readFileSync(".github/workflows/build-android.yml", "utf8"));
    const step = workflow.jobs.version.steps.find((step: any) => step.name === "Resolve app version");
    const result = spawnSync("bash", ["-c", step.run.replaceAll("${{ github.event.before }}", "HEAD")], { encoding: "utf8", env: {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_EVENT_NAME: "push",
      GITHUB_REPOSITORY: "example/codex-mobile", GITHUB_SHA: "HEAD", GITHUB_ENV: join(directory, "env"), GITHUB_OUTPUT: join(directory, "output"),
      REQUESTED_VERSION: "", PUBLISH_NPM_REQUESTED: "false", ENABLE_IOS_BUILD: "true",
      IOS_OTA_ENABLED: "true", IOS_OTA_BASE_URL: "https://updates.example.com/mobile",
    }});
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(directory, "output"), "utf8")).toContain(`app_version=${otaMajor}.0.1`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
