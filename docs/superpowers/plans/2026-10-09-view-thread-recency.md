# 查看会话不改变排序实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 查看、恢复会话后保持最近任务顺序，提交推送修复并发布递增版本 APK。

**Architecture:** 服务端恢复会话会持久化 `thread_settings_applied`，因此 `updatedAt` 不是纯任务时间。列表与搜索统一使用 `recencyAt → updatedAt → createdAt → 0`，RPC 使用 `recency_at`；同一会话的重复快照仍按 `updatedAt` 选择最新元数据。旧服务端缺失活动时间时保留原有回退。

**Tech Stack:** TypeScript、Vitest、Playwright、Vite、PakePlus Android、Gradle、Python APK server。

---

### Task 1: 回归测试与最小修复

**Files:**
- Modify: `src/features/threads/thread-list-model.ts`
- Modify: `src/app-server/thread-list-loader.ts`
- Modify: `src/app-server/thread-search.ts`
- Test: `tests/ui/thread-list-model.test.ts`
- Test: `tests/ui/thread-list-loader.test.ts`
- Test: `tests/ui/thread-search.test.ts`
- Test: `tests/e2e/mobile.spec.ts`

- [x] 添加查看前后 `updatedAt` 增大但 `recencyAt` 不变的列表及搜索回归，包含项目分组与元数据去重；修改 RPC 参数断言为 `recency_at`。核心数据与断言：

```ts
const records = [
  { id: "opened-history", recencyAt: 10, updatedAt: 100 },
  { id: "recent-activity", recencyAt: 20, updatedAt: 20 },
];
expect(dedupeThreadsById(records).map((thread) => thread.id))
  .toEqual(["recent-activity", "opened-history"]);
```

- [x] 执行 `npm test -- tests/ui/thread-list-model.test.ts tests/ui/thread-list-loader.test.ts tests/ui/thread-search.test.ts`，确认排序与 RPC 断言失败。
- [x] 三处排序时间选择改为：

```ts
return Number(thread.recencyAt ?? thread.updatedAt ?? thread.createdAt ?? 0);
```

五处 RPC 排序改为 `sortKey: "recency_at"`。列表和搜索去重条件保持元数据新鲜度：

```ts
if (!current || Number(thread.updatedAt ?? thread.createdAt ?? 0) >
  Number(current.updatedAt ?? current.createdAt ?? 0)) {
  unique.set(id, thread);
}
```

搜索中同一逻辑使用 `record` 变量替代 `thread`。
- [x] 上述单测通过；`npm run build` 成功；运行查看后刷新排序与搜索的 Playwright 用例。模拟恢复只增加 `updatedAt`，随后刷新列表仍保持最近任务在前；新任务增加 `recencyAt` 后正常前移。

### Task 2: 提交、构建、固定渠道发布

**Files:**
- Read: `docs/commit-conventions.md`
- Read: `.github/workflows/build-android.yml`
- Use: `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py`
- Temporary: `/private/tmp/codex-mobile-view-recency.*/`

- [ ] `git diff --check`；暂存本次修改；`git diff --cached --check` 和 `git diff --cached --name-status`；按规范提交中文 `fix`，正文含“新增功能：无”和主要修改；快进回 `main` 并 `git push origin main`。
- [ ] 固定渠道当前 `0.2.92`，选择 `0.2.93` / `2093`，发布前再次确认递增。从已推送 `HEAD` 用 `git archive` 导出独立源码，按工作流构建嵌入前端和固定 PakePlus 提交 `787b9e5ea2da1b2d959485417ffeee62f0d30960` 的 Android 项目。
- [ ] 按工作流执行图标、前端、PakePlus 配置和生成、Android 原生加固、Gradle 构建与 APK 校验。确认包名 `vip.loock.codexmobile`、版本、现有签名和内置前端一致。
- [ ] 固定渠道验收先执行并因旧版本失败：

```js
const base = "http://192.168.123.79:8765/channels/codex-mobile";
const manifest = await (await fetch(`${base}/latest.json`)).json();
assert.equal(manifest.version, "0.2.93");
assert.equal(manifest.size, local.length);
assert.equal(manifest.sha256, hash(local));
const head = await fetch(`${base}/latest.apk`, { method: "HEAD" });
assert.equal(head.status, 200);
assert.equal(Number(head.headers.get("content-length")), local.length);
const remote = Buffer.from(await (await fetch(`${base}/latest.apk`)).arrayBuffer());
assert.equal(remote.length, local.length);
assert.equal(hash(remote), hash(local));
```

- [ ] `python3 /Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK> --version 0.2.93 --notes '修复查看会话导致排序前移；列表、项目分页和搜索统一按最近任务活动时间排序。'`，再执行同一验收器通过。
- [ ] 删除本次临时文件；交付固定下载链接、版本、字节数、SHA-256。

## 自查

覆盖查看与恢复、列表刷新、项目分页、搜索、旧字段回退和重复记录元数据。用户项目规则已授权提交、推送与固定 APK 发布；当前工作连续且规模较小，在当前工作区修复分支直接执行，不需要额外委派。

## 修复验证记录

- RED：三个单测文件共 11 项按预期失败；浏览器实际复现打开旧会话后刷新排序前移。
- GREEN：相关四个单测文件共 49 项通过；两个手机尺寸浏览器用例通过；TypeScript 与 Vite 构建成功。
- 数据证据：反馈会话任务活动时间未改变，而查看时写入 `thread_settings_applied` 推进了元数据时间。
