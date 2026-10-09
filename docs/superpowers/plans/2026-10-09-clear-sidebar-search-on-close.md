# 关闭边栏时清空会话搜索实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话逐项执行，并遵循 TDD 与 verification-before-completion；本次修改按仓库约定直接提交和推送。

**目标：** 关闭会话边栏后清空搜索词和搜索结果，再次打开时显示常规会话列表。

**架构：** `ConfiguredApp` 持有搜索词，所有关闭入口共用 `useSidebarRefresh` 的边栏状态。在边栏关闭时清空搜索词，复用现有搜索 effect 的请求取消和结果清理逻辑。

**技术栈：** React、TypeScript、Playwright、Vitest、GitHub Actions。

## 任务 1：失败回归

- [x] 扩展 `tests/e2e/mobile.spec.ts` 的“会话搜索在一个结果列表中展示服务端全文命中”场景：搜索后点击遮罩，断言搜索值为空；再次打开后断言普通会话恢复且全文命中片段消失；继续覆盖返回关闭与搜索请求期间关闭。
- [x] 运行 `npx playwright test tests/e2e/mobile.spec.ts -g '会话搜索在一个结果列表中展示服务端全文命中'`，确认因为关闭后仍保留搜索词而失败。

## 任务 2：最小实现

- [x] 在 `src/App.tsx` 的 `ConfiguredApp` 加入以下状态同步：

```tsx
useEffect(() => {
  if (!sidebarOpen) setQuery("");
}, [sidebarOpen]);
```

- [x] 运行上述 Playwright 场景、`npm test -- tests/ui/thread-list-page.test.tsx tests/ui/sidebar-refresh.test.tsx tests/ui/sidebar-swipe.test.tsx tests/ui/thread-search.test.ts` 和 `npm run build`，确认全部通过。
- [ ] 检查并仅暂存本次三个文件，按 `docs/commit-conventions.md` 提交和推送。

## 任务 3：双平台发布

- [ ] 读取两个固定清单，选择同时高于现有版本的统一版本，通过已推送提交的移动端流水线构建 APK 与未签名 IPA。
- [ ] 下载构建产物，检查内置版本，使用 `apk-server.py publish-channel codex-mobile <安装包> --version <版本> --notes <说明>` 分别发布。
- [ ] 通过各自 JSON、HEAD、完整 GET 核对版本、文件大小和 SHA-256，交付两个固定链接及 IPA 签名状态。
- [ ] 清理本次临时下载和校验文件。

## 验证记录

- Chromium 回归先失败：关闭后搜索框仍为“部署失败”；最小修复后 1 项浏览器测试通过。
- 相关 Vitest 测试：8 个文件、76 项通过。
- `npm run build`：类型检查与生产构建通过。
- 固定 Android 和 iOS 渠道当前均为 `0.2.102`，本次使用统一版本 `0.2.103`。
