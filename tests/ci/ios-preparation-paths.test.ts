import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")("iOS 准备在包含空格、单引号及美元符号的工作区使用原始路径复制原生桥", () => {
  const temporary = mkdtempSync(join(tmpdir(), "ios-path-fixture-"));
  const project = join(temporary, "Application Support's $workspace");
  const fakeBin = join(temporary, "fake-tools");
  mkdirSync(join(project, "scripts"), { recursive: true });
  mkdirSync(join(project, "mobile/ios"), { recursive: true });
  mkdirSync(fakeBin);
  try {
    copyFileSync("scripts/prepare-ios.mjs", join(project, "scripts/prepare-ios.mjs"));
    copyFileSync("mobile/ios/build-recipe.yml", join(project, "mobile/ios/build-recipe.yml"));
    writeFileSync(join(project, "package.json"), '{"type":"module","version":"0.2.165"}');
    symlinkSync(resolve("node_modules"), join(project, "node_modules"), "dir");
    const bridges = ["InAppBrowserViewController.swift", "AttachmentPickerBridge.swift", "AppUpdateBridge.swift", "ActionMenuBridge.swift", "KeyboardDismissal.swift"];
    for (const name of bridges) writeFileSync(join(project, "mobile/ios", name), `fixture ${name}\n`);
    writeFileSync(join(fakeBin, "git"), `#!/bin/sh\nmkdir -p "$PWD/PakePlus/Assets.xcassets/AppIcon.appiconset"\nprintf '{"images":[]}' > "$PWD/PakePlus/Assets.xcassets/AppIcon.appiconset/Contents.json"\n`);
    writeFileSync(join(fakeBin, "bash"), `#!/bin/sh\nfor arg in "$@"; do\n case "$arg" in *'source="mobile/ios/InAppBrowserViewController.swift"'*) exec /bin/bash "$@" ;; esac\ndone\nexit 0\n`);
    for (const name of ["git", "bash"]) chmodSync(join(fakeBin, name), 0o755);
    const entry = join(project, "scripts/prepare-ios.mjs");
    const result = spawnSync(process.execPath, [entry, "--version", "0.2.165"],
      { cwd: project, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }, encoding: "utf8" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    for (const name of bridges) expect(readFileSync(join(project, ".mobile-build/ios/pakeplus/PakePlus", name), "utf8")).toBe(`fixture ${name}\n`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
