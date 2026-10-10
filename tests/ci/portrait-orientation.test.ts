import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function hardeningScript(platform: string, stepName: string) {
  const recipe = parse(readFileSync(`mobile/${platform}/build-recipe.yml`, "utf8"));
  return recipe.steps.find((step: any) => step.name === stepName).run as string;
}

function fixture(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "codex-mobile-portrait-"));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("移动端强制竖屏", () => {
  it.each(["portrait", "1", "0x1", "landscape", "0", "sensor", undefined])("APK 校验识别编译后的方向枚举 %s", (orientation) => {
    const recipe = parse(readFileSync("mobile/android/build-recipe.yml", "utf8"));
    const verify = recipe.steps.find((step: any) => step.name === "Prepare and verify APK").run as string;
    const script = verify.slice(verify.indexOf("activities = {"), verify.indexOf("providers = {"));
    const result = spawnSync("python3", ["-c", `
import xml.etree.ElementTree as ET
android = "http://schemas.android.com/apk/res/android"
application = ET.Element("application")
for name in ("com.app.pakeplus.MainActivity", "com.app.pakeplus.InAppBrowserActivity"):
    activity = ET.SubElement(application, "activity")
    activity.set(f"{{{android}}}name", name)
    value = ${JSON.stringify(orientation ?? "")}
    if value:
        activity.set(f"{{{android}}}screenOrientation", value)
` + script], { encoding: "utf8" });
    expect(result.status === 0, result.stderr).toBe(["portrait", "1", "0x1"].includes(orientation ?? ""));
  });

  it("Android 生成的主界面与应用内浏览器均锁定正向竖屏", () => fixture((directory) => {
    mkdirSync(join(directory, "app/src/main"), { recursive: true });
    writeFileSync(join(directory, "app/src/main/AndroidManifest.xml"), `
      <manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application>
          <activity android:name=".MainActivity" android:screenOrientation="sensor" />
          <activity android:name=".InAppBrowserActivity" android:screenOrientation="landscape" />
        </application>
      </manifest>`);
    const script = hardeningScript("android", "Harden and test embedded Android project")
      .split("python3 - <<'PY'\n")[1].split('Path("app/src/main/res/xml/update_file_paths.xml")')[0];
    const result = spawnSync("python3", ["-c", script + `
import json
print(json.dumps({activity.get(f"{{{android}}}name"): activity.get(f"{{{android}}}screenOrientation") for activity in ET.parse(manifest_path).getroot().find("application").findall("activity")}))
`], { cwd: directory, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ".MainActivity": "portrait", ".InAppBrowserActivity": "portrait" });
  }));

  it("iOS 两个构建配置的 iPhone/iPad 仅允许正向竖屏，iPad 使用全屏约束", () => fixture((directory) => {
    mkdirSync(join(directory, "PakePlus.xcodeproj"));
    mkdirSync(join(directory, "PakePlus"));
    writeFileSync(join(directory, "PakePlus/Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
    writeFileSync(join(directory, "PakePlus.xcodeproj/project.pbxproj"), ["Debug", "Release"].map(() => `
      MARKETING_VERSION = 1.0.0;
      CURRENT_PROJECT_VERSION = 1;
      INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight UIInterfaceOrientationPortrait";
      INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown";
    `).join("\n"));
    const script = hardeningScript("ios", "Harden and test the iOS host")
      .split("python3 - <<'PY'\n")[1].split('content_path = Path("PakePlus/ContentView.swift")')[0];
    const result = spawnSync("python3", ["-c", script + `
import json, plistlib
print(json.dumps(plistlib.loads(Path("PakePlus/Info.plist").read_bytes())))
`], { cwd: directory, encoding: "utf8", env: { ...process.env, APP_VERSION: "0.2.107" } });
    expect(result.status, result.stderr).toBe(0);
    const project = readFileSync(join(directory, "PakePlus.xcodeproj/project.pbxproj"), "utf8");
    expect(project.match(/INFOPLIST_KEY_UISupportedInterfaceOrientations(?:_iPad)? = "?UIInterfaceOrientationPortrait"?;/g)).toHaveLength(4);
    expect(project).not.toMatch(/Landscape|UpsideDown/);
    expect(JSON.parse(result.stdout).UIRequiresFullScreen).toBe(true);
  }));
});
