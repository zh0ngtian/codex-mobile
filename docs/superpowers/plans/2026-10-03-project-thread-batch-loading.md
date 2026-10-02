# 项目会话“更多”分批加载实施计划

> **执行要求：** 当前环境未暴露 superpowers Skill；按仓库既有 superpowers 计划格式执行，并遵循 TDD、系统化调试和完成前验证流程。

**目标：** 将会话侧栏每个项目下的“更多”从一次读取全部历史改为每次追加 5 条，避免长历史项目因大量网络请求和一次性渲染而变慢。

**现状证据：** 项目首页只请求最近 5 条；点击“更多”后，`loadAllProjectThreadRecords` 会沿 `nextCursor` 循环到末页，`ConfiguredApp` 同时把可见数量设为 `Number.MAX_SAFE_INTEGER`。因此单次点击会读取并展示全部剩余会话。

**实现策略：** 保留首页 5 条基线及其 `nextCursor`；普通项目每次点击只用该游标请求后续 5 条并追加。无项目会话无法按目录直接分页，因此按“当前数量 + 5”的目标从全局列表收集，达到目标即停止。服务端仍有下一页时继续显示“更多”，耗尽后隐藏。

## 任务 1：先写失败的分批加载测试

**文件：**

- 修改 `tests/ui/thread-list-loader.test.ts`
- 修改 `tests/ui/thread-list-page.test.tsx`

1. 断言项目加载只发出一次 `limit: 5` 的游标请求，即使响应仍带 `nextCursor` 也不继续追到末页。
2. 断言下一批目标数量固定增加 5。
3. 断言项目没有下一页时隐藏“更多”，仍有下一页时保留入口。
4. 先运行聚焦测试，确认现有“读取全部历史”实现不满足新断言。

## 任务 2：实现项目与无项目会话分批读取

**文件：**

- 修改 `src/app-server/thread-list-loader.ts`
- 修改 `src/App.tsx`
- 修改 `src/features/threads/ThreadListPage.tsx`

1. 用单批加载函数替代全量循环函数；项目请求沿游标只取 5 条，无项目请求收集到目标数量后停止。
2. “更多”根据当前项目已加载记录数计算下一目标数量，每次只增加 5。
3. 成功后把下一批追加到项目并更新游标与 `hasMore`；失败时保留旧数据，可再次重试。
4. 列表直接展示当前已加载记录，不再把可见数量一次设为无限大。

## 任务 3：验证、提交与固定渠道发布

1. 运行聚焦 Vitest、完整 `npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`。
2. 按提交规范提交并推送本次改动，不混入无关文件。
3. 读取固定渠道现有版本，构建更高版本 Android APK。
4. 使用 `apk-server.py publish-channel codex-mobile` 发布，并通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
5. 清理本次生成且不再需要的临时文件。
