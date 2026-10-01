# Android Thread History Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the current thread de-duplication and complete-history changes into an Android APK, install it over the connected test device, and verify the behavior in Codex Mobile.

**Architecture:** Keep the user's dirty `main` checkout untouched except for the already-authorized source and test changes. Copy the working tree into a temporary build root, clone the workflow-pinned PakePlus Android container there, and execute the repository's own Android workflow scripts with a temporary JDK 17. Install only after the new APK signer matches the currently installed application signer.

**Tech Stack:** React 19, TypeScript, Vitest, Vite, PakePlus Android, Gradle, Android SDK/ADB.

---

### Task 1: Re-run the TDD and production build gates

**Files:**
- Verify: `tests/ui/thread-list-loader.test.ts`
- Verify: `tests/ui/thread-list-page.test.tsx`
- Verify: `src/app-server/thread-list-loader.ts`
- Verify: `src/features/threads/ThreadListPage.tsx`

- [x] **Step 1: Run the focused regression tests**

Run:

```bash
npm test -- tests/ui/thread-list-loader.test.ts tests/ui/thread-list-page.test.tsx tests/ui/thread-list-model.test.ts
```

Expected: 3 test files and 26 tests pass.

- [x] **Step 2: Run the complete test suite with Node 26 WebStorage disabled**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage npm test
```

Expected: 50 test files and 328 tests pass.

- [x] **Step 3: Build the embedded frontend with the verification version**

Run:

```bash
VITE_APP_VERSION=0.2.27 npm run build
```

Expected: TypeScript compilation and the Vite production build succeed, with `dist/index.html` and a JavaScript bundle under `dist/assets/`.

### Task 2: Prepare an isolated temporary Android build root

**Files:**
- Read: `.github/workflows/build-android.yml`
- Temporary: `/private/tmp/codex-mobile-android.*/repo`
- Temporary: `/private/tmp/codex-mobile-android.*/jdk17`

- [x] **Step 1: Copy the current working tree without Git metadata or dependencies**

Run:

```bash
build_root="$(mktemp -d /private/tmp/codex-mobile-android.XXXXXX)"
mkdir -p "$build_root/repo" "$build_root/runner-temp" "$build_root/jdk17"
rsync -a --exclude .git --exclude node_modules --exclude dist ./ "$build_root/repo/"
```

Expected: the temporary repository contains the current uncommitted source and regression tests while the original checkout remains unchanged.

- [x] **Step 2: Clone the workflow-pinned Android container**

Run:

```bash
git clone https://github.com/Sjj1024/PakePlus-Android.git "$build_root/repo/pakeplus"
git -C "$build_root/repo/pakeplus" checkout 787b9e5ea2da1b2d959485417ffeee62f0d30960
```

Expected: `HEAD` equals `787b9e5ea2da1b2d959485417ffeee62f0d30960`.

- [x] **Step 3: Download a temporary JDK 17**

Run:

```bash
curl -fL 'https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse?project=jdk' -o "$build_root/jdk17.tar.gz"
tar -xzf "$build_root/jdk17.tar.gz" -C "$build_root/jdk17"
java_bin="$(find "$build_root/jdk17" -path '*/Contents/Home/bin/java' -print -quit)"
jdk_home="${java_bin%/bin/java}"
"$jdk_home/bin/java" -version
```

Expected: the command reports Java 17 without modifying the system Java installation.

### Task 3: Execute the repository Android workflow locally

**Files:**
- Read: `.github/workflows/build-android.yml`
- Temporary: `/private/tmp/codex-mobile-android.*/repo/run-workflow-steps.mjs`
- Temporary: `/private/tmp/codex-mobile-android.*/bin/convert`
- Output: `/private/tmp/codex-mobile-android.*/runner-temp/apk/CodexMobile-v0.2.27.apk`

- [x] **Step 1: Create a temporary workflow-step runner**

Create `$build_root/repo/run-workflow-steps.mjs` with this implementation:

```javascript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const root = resolve(process.argv[2]);
const workflow = parse(
  readFileSync(resolve(root, ".github/workflows/build-android.yml"), "utf8"),
);
const selected = [
  "Install Codex Mobile app icon",
  "Build embedded frontend",
  "Configure PakePlus for embedded HTML",
  "Install PakePlus dependencies",
  "Generate Android project",
  "Harden and test embedded Android project",
  "Build debug APK",
  "Prepare and verify APK",
];
const steps = workflow.jobs.build.steps;
for (const name of selected) {
  const step = steps.find((candidate) => candidate.name === name);
  if (!step?.run) throw new Error(`Missing workflow step: ${name}`);
  const cwd = resolve(root, step["working-directory"] ?? ".");
  const result = spawnSync("bash", ["-c", step.run], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Workflow step failed: ${name}`);
  }
}
```

- [x] **Step 2: Bootstrap the copied repository dependencies**

Run:

```bash
npm ci --prefix "$build_root/repo"
```

Expected: the temporary runner can resolve `yaml` from the copied repository without relying on the original checkout's `node_modules`.

- [x] **Step 3: Provide the workflow's ImageMagick-compatible icon commands**

Create a temporary `convert` shim backed by PakePlus's locked `sharp` dependency. It must implement only the two command forms used by the pinned `ppworker.cjs`: solid PNG canvas generation and centered transparent icon resizing/extension.

Expected: the shim is executable from `$build_root/bin/convert` and creates valid PNG resources without installing global software.

- [x] **Step 4: Run the selected workflow steps with explicit Android metadata**

Run:

```bash
APP_NAME=CodexMobile \
DISPLAY_NAME='Codex Mobile' \
APP_ID=vip.loock.codexmobile \
APP_VERSION=0.2.27 \
APP_VERSION_CODE=37 \
RUNNER_TEMP="$build_root/runner-temp" \
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools \
JAVA_HOME="$jdk_home" \
PATH="$jdk_home/bin:$build_root/bin:/opt/homebrew/share/android-commandlinetools/platform-tools:/opt/homebrew/share/android-commandlinetools/build-tools/36.1.0:$PATH" \
node "$build_root/repo/run-workflow-steps.mjs" "$build_root/repo"
```

Expected: all workflow assertions pass and the APK plus SHA-256 file exist in `$build_root/runner-temp/apk/`.

### Task 4: Verify signing, install, and validate on the physical device

**Files:**
- APK: `/private/tmp/codex-mobile-android.*/runner-temp/apk/CodexMobile-v0.2.27.apk`
- Device package: `vip.loock.codexmobile`

- [x] **Step 1: Compare signer certificates before installation**

Run `apksigner verify --print-certs` on the official `v0.2.26` APK and the locally built `v0.2.27` APK.

Expected: signer certificate SHA-256 digests are identical. Stop without uninstalling if they differ.

- [x] **Step 2: Install as an in-place update**

Run:

```bash
adb -s AXGE022B07001779 install -r "$build_root/runner-temp/apk/CodexMobile-v0.2.27.apk"
```

Expected: `Success`; existing gateway configuration remains available.

- [x] **Step 3: Verify package metadata and application connectivity**

Run `dumpsys package`, launch `com.app.pakeplus.MainActivity`, and inspect the UI hierarchy.

Expected: `versionName=0.2.27`, `versionCode=37`, and `Yao-Mac-mini，已连接` is visible.

- [x] **Step 4: Verify the original regression in Codex Mobile**

Open the `GlobalTranslation` project in the single-device view, inspect the visible task rows, and activate `更多` when present.

Expected: `规划拍照翻译二次开发` appears exactly once; after `更多`, every unique non-archived historical thread returned by the gateway is visible.

- [x] **Step 5: Clean temporary build and UI inspection files**

Remove only the explicit `$build_root` directory and diagnostic XML files created by this plan.

Expected: the repository contains only the authorized source, test, localization, and plan changes.

## Self-review

- Spec coverage: duplicate suppression, complete history loading, APK construction, signer safety, in-place installation, persistence, and physical-device UI verification are all mapped to tasks.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation step remains.
- Type consistency: Android package, activity, device serial, app version, version code, workflow commit, and project path match the inspected repository and device state.
