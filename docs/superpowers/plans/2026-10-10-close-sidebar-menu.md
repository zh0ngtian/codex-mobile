# 关闭边栏时收起长按菜单实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话逐项执行，遵循 TDD 与 verification-before-completion；按仓库约定提交、推送并发布双平台统一版本。

**目标：** 关闭边栏同步关闭会话长按弹窗，重新打开边栏不恢复旧弹窗。

**架构：** `ConfiguredApp` 把统一的 `sidebarOpen` 状态传入 `ThreadListPage`。列表保留挂载和滚动位置，关闭时清理菜单、长按计时器和点击抑制状态；菜单显示同时受边栏状态约束。

**技术栈：** React、TypeScript、Vitest、Playwright、GitHub Actions、iOS Ad Hoc OTA。

## 任务 1：失败回归

- [x] 在 `tests/ui/thread-list-page.test.tsx` 复用真实列表，暴露通过 `rerender(cloneElement(element, { sidebarOpen }))` 切换边栏的测试入口。
- [x] 添加“关闭边栏收起长按菜单，再打开不会恢复旧菜单或吞掉点击”：长按 550ms 后确认菜单存在，关闭后确认菜单不存在，再打开后普通点击能打开会话，右键仍能打开新菜单。
- [x] 添加“长按计时期间关闭边栏会取消菜单，重新打开也不补弹”：按下后等待 250ms，关闭、重新打开，再推进 550ms，确认菜单不存在。
- [x] 运行 `npm test -- tests/ui/thread-list-page.test.tsx -t '关闭边栏|长按计时'`，两项均因菜单仍存在而失败。

## 任务 2：最小修复与集成验证

- [x] 在 `src/features/threads/ThreadListPage.tsx` 增加 `sidebarOpen = true`、`sidebarOpen?: boolean`，关闭时执行：

```tsx
useEffect(() => {
  if (sidebarOpen) return;
  clearLongPress();
  suppressClickRef.current = null;
  setManagedThread(null);
}, [sidebarOpen]);
```

- [x] 菜单使用 `open={sidebarOpen && managedThread !== null}`；长按和右键入口在边栏关闭时不创建菜单。
- [x] 在 `src/App.tsx` 的 `<ThreadListPage>` 传入 `sidebarOpen={sidebarOpen}`。
- [x] 在 `tests/e2e/mobile.spec.ts` 的全文搜索场景开头覆盖浏览器返回关闭：

```tsx
await page.getByRole("button", { name: /普通标题/ }).dispatchEvent("contextmenu");
await expect(page.getByLabel("会话操作", { exact: true })).toBeVisible();
await page.goBack();
await expect(page.locator(".conversation-sidebar-layer")).not.toHaveClass(/open/);
await expect(page.getByLabel("会话操作", { exact: true })).toHaveCount(0);
await page.getByRole("button", { name: "打开会话列表" }).click();
await expect(page.getByLabel("会话操作", { exact: true })).toHaveCount(0);
```

- [x] 运行相关列表、边栏刷新、滑动、回退测试：`npm test -- tests/ui/thread-list-page.test.tsx tests/ui/sidebar-refresh.test.tsx tests/ui/sidebar-swipe.test.tsx tests/ui/web-only-rollback.test.tsx`，预期全部通过。
- [x] 运行 `npm run build`，预期类型检查与构建通过。
- [x] 运行 `npx playwright test tests/e2e/mobile.spec.ts -g '会话搜索在一个结果列表中展示服务端全文命中'`，预期通过。

## 任务 3：提交和双端发布

- [x] 执行 `git diff --check`，按 `docs/commit-conventions.md` 提交本次文件并推送到 `origin/main`，不覆盖并行任务提交。
- [x] 固定渠道发布期间持有本机独占锁，读取 Android 和 iOS 固定清单，分配高于两端的统一版本。
- [x] 从已推送提交运行 `build-android.yml` 的 `workflow_dispatch`，显式指定统一版本，下载 `CodexMobile-android` 并核对 APK 内置版本及本次资源。
- [x] 执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '关闭边栏时同步收起会话长按菜单'`，预期 Ad Hoc 验签、身份连续性与 HTTPS/HTTP 完整回验通过。
- [x] 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK> --version <统一版本> --notes '关闭边栏时同步收起会话长按菜单'` 发布 Android。
- [x] 通过两端固定 JSON、HEAD、完整 GET 核对版本、文件大小、SHA-256；交付固定 OTA、APK、IPA 链接及实际元数据、IPA 签名状态。
- 本次浏览器测试使用协议模拟，没有创建真实测试会话。交付前清理临时构建目录，并使用原生 worktree 工具归档。

## 验证记录

- 基线列表 26 项通过；新增两个回归均先因菜单残留失败，修复后相关 4 文件、43 项通过。
- 本机 Node 26 使用 `NODE_OPTIONS=--no-experimental-webstorage` 避免原生 localStorage 干扰 jsdom。
- `npm run build` 类型检查与生产构建通过。
- 使用 `PLAYWRIGHT_CHANNEL=chromium HOST=127.0.0.1 PORT=4173 CODEX_APP_SERVER_MODE=external CODEX_APP_SERVER_URL=ws://127.0.0.1:19999` 执行上述 Playwright 场景，1 项通过；场景结束移除未完成的协议 mock 路由，避免 teardown 报错。
- 固定发布锁已获得，两端固定版本为 0.2.136；本次统一版本选择 0.2.137，iOS 配置和身份连续性预检通过。
- 真机覆盖安装和数据保留不在本次构建、发布验证范围内。

## 发布结果

- 源码提交：`04f259089bb0810910bc3ac7ec295e9f9a55a651`，已推送 `origin/main`。
- [双端构建流水线](https://github.com/zh0ngtian/codex-mobile/actions/runs/38017821835)成功，Android 与 iOS 均为 0.2.137 / build 2137；固定 iOS 使用本机 Ad Hoc 签名产物。
- [固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)与固定 HTTPS JSON 已通过受信任 CA 回验。
- [Android 固定下载](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)：版本 0.2.137，4,708,027 字节，SHA-256 `ecf038cba8a229de2c848cc14807c96e97164aeba4c43c9ddb340d5e1ba0478c`。
- [iOS 固定下载](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)：版本 0.2.137，3,772,845 字节，SHA-256 `6b36992b8f37c9c2bba3f39058b91b1be5e0c376f6b98bb97e87a650ccd86360`，Ad Hoc 已签名。
- 两端均通过固定 JSON、HEAD 与完整 GET 的版本、大小、SHA-256 核对；内嵌主前端 JS 字节一致，包含本次边栏菜单状态修复。
- 真机覆盖安装和数据保留未执行；本次完成交互回归、构建、验签与渠道回验。
