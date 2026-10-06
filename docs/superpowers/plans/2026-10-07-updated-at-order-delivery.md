# 会话更新时间排序与固定渠道交付实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话排序统一为 `updatedAt → createdAt`，交付包含该修改且版本高于固定渠道的同签名 APK。

**Architecture:** 列表派生、分页加载和全文及标题搜索统一按更新时间排序，不再使用 `recencyAt`。排序代码已独立提交并推送，发布从已提交快照构建，复用工作流固定提交的 Android 容器和签名。固定渠道先验收失败，再发布并验收成功。

**Tech Stack:** TypeScript、Vitest、Vite、PakePlus Android、Gradle、Python APK server、Node.js HTTP 与 SHA-256 验收。

---

### Task 1: 排序改动与回归验证（已完成）

**Files:**
- Modify: `src/features/threads/thread-list-model.ts`
- Modify: `src/app-server/thread-list-loader.ts`
- Modify: `src/app-server/thread-search.ts`
- Test: `tests/ui/thread-list-model.test.ts`
- Test: `tests/ui/thread-list-loader.test.ts`
- Test: `tests/ui/thread-search.test.ts`
- Test: `tests/e2e/mobile.spec.ts`

- [x] 先调整原有排序及 RPC 参数断言：列表以 `updatedAt` 排序，缺失时用 `createdAt`；RPC 使用 `sortKey: "updated_at"`。运行三个单测文件，10 项按预期失败。
- [x] 将三个时间选择函数改为 `return Number(thread.updatedAt ?? thread.createdAt ?? 0);`；将五个列表及搜索请求的 `sortKey` 改为 `updated_at`。
- [x] 在已有缺失 `updatedAt` 的用例中保留一个很大的 `recencyAt`，验证回退到 `createdAt`，而非活动时间。
- [x] 运行相关四个单测文件，45 项通过；运行 `npm run build` 成功。端到端测试因本机缺少 Chrome 未执行成功，不能宣称通过。
- [x] 阅读 `docs/commit-conventions.md`，提交并推送 `ce050f4`，只包含排序相关七个文件。

### Task 2: 固定版本构建

**Files:**
- Read: `.github/workflows/build-android.yml`
- Temporary: `/private/tmp/codex-mobile-updated-order.*/repo/`
- Temporary: `/private/tmp/codex-mobile-updated-order.*/runner-temp/`

- [ ] 读取固定渠道 JSON；选择 `0.2.84` / Android versionCode `2084`，发布前再次比较渠道版本，确保严格递增。
- [ ] 提交并推送此计划，然后使用 `git archive HEAD` 导出当前已提交源代码到独立临时目录。不能把其他未提交文件打进 APK。
- [ ] 使用缓存的 PakePlus Android 仓库导出固定提交 `787b9e5ea2da1b2d959485417ffeee62f0d30960` 到构建目录；复用现有 JDK 17 和 Android SDK。
- [ ] 按仓库工作流原样执行：`Install Codex Mobile app icon`、`Build embedded frontend`、`Configure PakePlus for embedded HTML`、`Install PakePlus dependencies`、`Generate Android project`、`Harden and test embedded Android project`、`Build debug APK`、`Prepare and verify APK`。环境设置 `APP_VERSION=0.2.84`、`APP_VERSION_CODE=2084`、`APP_ID=vip.loock.codexmobile`、`APP_NAME=CodexMobile`、`DISPLAY_NAME='Codex Mobile'`、`RUNNER_TEMP` 为临时构建目录。
- [ ] 使用 `apksigner verify --print-certs` 检查 APK 签名，并与渠道现有 APK 比较证书；使用 `apkanalyzer manifest` 检查包名、版本名、版本号。逐个比较 APK 内置资源与本次 `dist/` 的字节及 SHA-256。

### Task 3: 固定渠道 RED / GREEN 验收

**Files:**
- Temporary: `/private/tmp/codex-mobile-updated-order.*/verify-channel.mjs`
- Use: `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py`

- [ ] 创建如下验收器并在发布前运行，预期因为旧渠道版本与本次版本不同而失败；需要明确看到断言失败，不能把网络错误当作 RED。

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [apk, expectedVersion] = process.argv.slice(2);
const local = readFileSync(apk);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base = 'http://192.168.123.79:8765/channels/codex-mobile';
const jsonResponse = await fetch(`${base}/latest.json`, { cache: 'no-store' });
assert.equal(jsonResponse.status, 200);
const manifest = await jsonResponse.json();
assert.equal(manifest.version, expectedVersion, '固定渠道版本尚未更新');
assert.equal(manifest.downloadUrl, `${base}/latest.apk`);
assert.equal(manifest.size, local.length);
assert.equal(manifest.sha256, hash(local));
const head = await fetch(`${base}/latest.apk`, { method: 'HEAD', cache: 'no-store' });
assert.equal(head.status, 200);
assert.equal(Number(head.headers.get('content-length')), local.length);
assert.match(head.headers.get('content-type'), /application\/vnd\.android\.package-archive/);
const response = await fetch(`${base}/latest.apk`, { cache: 'no-store' });
assert.equal(response.status, 200);
const remote = Buffer.from(await response.arrayBuffer());
assert.equal(remote.length, local.length);
assert.equal(hash(remote), hash(local));
console.log(JSON.stringify({ version: expectedVersion, size: local.length, sha256: hash(local), url: `${base}/latest.apk` }));
```

- [ ] 发布：`python3 /Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <本次 APK 路径> --version 0.2.84 --notes '会话列表、项目分页和搜索结果改按更新时间排序，缺失时使用创建时间，不再使用活动时间。'`。
- [ ] 原样运行验收器，预期退出码 0；核对 JSON、HEAD、GET 的版本、大小和 SHA-256 一致。
- [ ] 收尾删除本次临时构建目录，保留固定渠道服务上的发布产物；交付固定 APK 链接、版本号、字节数和完整 SHA-256。

## 自查

排序、分页和搜索范围已全部覆盖；固定渠道的递增版本、相同签名、内置资源一致性、JSON/HEAD/GET 验收与临时文件清理均有明确步骤。用户已确认使用 superpowers 计划与 TDD 流程，无需再次询问发布许可。
