# Codex Mobile LAN APK Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the installed, verified Codex Mobile v0.2.27 APK through GlobalTranslation's existing 48-hour LAN APK server and prove the published bytes are identical.

**Architecture:** Treat the connected device's installed base APK as the authoritative artifact from the completed build-and-install verification. Use the existing `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py` process and HTTP API without copying its implementation or serving any project directory. Define the delivery acceptance contract before upload, then verify the server response, HEAD metadata, downloaded bytes, SHA-256, and expiry.

**Tech Stack:** ADB, Android build tools, Python launchd service, HTTP PUT/HEAD/GET, Node.js acceptance verifier, SHA-256.

---

### Task 1: Check the existing LAN service

**Files:**
- Read: `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py`
- Use without modification: `/Users/zhongtian/WorkSpace/GlobalTranslation/.local-apk-server/`

- [x] **Step 1: Check managed process status**

Run from the GlobalTranslation root:

```bash
python3 scripts/apk-server.py status
```

Expected: JSON identifies `local.globaltranslation.apk-server` and the configured URL, or exits non-zero with `status: stopped`.

- [x] **Step 2: Start only when stopped** *(not needed; service was already healthy)*

If Step 1 reports stopped, run:

```bash
python3 scripts/apk-server.py start --base-url http://192.168.123.79:8765
```

Expected: service JSON reports the requested LAN base URL.

- [x] **Step 3: Verify local and LAN health endpoints**

Run:

```bash
curl --fail-with-body http://127.0.0.1:8765/health
curl --fail-with-body http://192.168.123.79:8765/health
```

Expected: both return HTTP 200 with `ttl_hours: 48`.

### Task 2: Recover and validate the installed APK

**Files:**
- Create temporarily: `/private/tmp/CodexMobile-v0.2.27.apk`
- Read from device: installed package `vip.loock.codexmobile`

- [x] **Step 1: Resolve and pull the installed base APK**

Run `adb -s AXGE022B07001779 shell pm path vip.loock.codexmobile`, then pull the reported `base.apk` to `/private/tmp/CodexMobile-v0.2.27.apk`.

Expected: a non-empty standalone APK is present locally.

- [x] **Step 2: Verify identity, signature, size, and digest before upload**

Run `apksigner verify --print-certs`, inspect package metadata, confirm the file is below 100 MiB, and calculate SHA-256.

Expected: package is `vip.loock.codexmobile`, version is `0.2.27` / code `37`, signer SHA-256 is `28fbc71e4f991bcfa204d2c15c914bae4a114fcb05a1d46ffd935f80d2920554`, and the artifact digest matches the installed build when available.

### Task 3: Drive the upload through an acceptance contract

**Files:**
- Create temporarily: `/private/tmp/verify-codexmobile-apk-delivery.mjs`
- Create temporarily: `/private/tmp/codexmobile-upload.json`
- Create temporarily: `/private/tmp/CodexMobile-v0.2.27-downloaded.apk`

- [x] **Step 1: Write the delivery acceptance verifier**

The verifier must fail when the upload response is missing. With a response present, it must assert the response URL is under `http://192.168.123.79:8765/files/`, response bytes and SHA-256 match the local APK, expiry is approximately 48 hours in the future, HEAD returns the APK media type and correct length, and a fresh GET has the same size and SHA-256.

- [x] **Step 2: Run the verifier before upload and confirm RED**

Run it before `/private/tmp/codexmobile-upload.json` exists.

Expected: non-zero exit with `Upload response is missing`.

- [x] **Step 3: Upload through the existing HTTP endpoint**

Run:

```bash
curl --fail-with-body --upload-file /private/tmp/CodexMobile-v0.2.27.apk \
  http://192.168.123.79:8765/upload/CodexMobile-v0.2.27.apk
```

Save the JSON response as `/private/tmp/codexmobile-upload.json`.

Expected: HTTP 201 JSON contains `url`, `bytes`, `sha256`, and `expires_at`.

- [x] **Step 4: Run the verifier after upload and confirm GREEN**

Expected: exit 0 with the direct URL, byte count, SHA-256, content type, and expiry.

### Task 4: Record evidence and clean local temporary files

**Files:**
- Delete: `/private/tmp/CodexMobile-v0.2.27.apk`
- Delete: `/private/tmp/CodexMobile-v0.2.27-downloaded.apk`
- Delete: `/private/tmp/verify-codexmobile-apk-delivery.mjs`
- Delete: `/private/tmp/codexmobile-upload.json`

- [x] **Step 1: Re-run a final HEAD and streamed SHA-256 check**

Expected: the live link still returns HTTP 200, the APK content type, the same byte count, and the same SHA-256.

- [x] **Step 2: Preserve only the server-hosted copy**

Remove the explicit temporary files above after recording their verified metadata. Do not stop the service and do not remove its `.local-apk-server` state.

Expected: the direct link remains live while local verification copies are gone.

## Self-review

- Spec coverage: service status/start, existing server reuse, 100 MiB limit, PUT upload, link accessibility, size, SHA-256, 48-hour expiry, and final direct-link reporting are all covered.
- Exposure safety: no command serves the repository or copies `apk-server.py`; only the existing managed service state receives the APK.
- TDD scope: no production code changes are authorized, so the red-green cycle is limited to the delivery acceptance contract around the external artifact.
