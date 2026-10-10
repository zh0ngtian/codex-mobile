# 项目拖动排序实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话逐项执行，遵循 TDD 与 verification-before-completion；开发与构建使用独立 worktree，按仓库约定提交、推送并发布统一版本。

**目标：** 边栏项目支持拖动排序，同一机器的新聊天项目选择沿用排序，重开客户端保留。

**架构：** `ConfiguredApp` 持有按 backend ID 隔离的项目顺序，使用 `codex-mobile:project-order` 保存本机偏好。`ThreadListPage` 与 `BackendWorkspace` 共用排序函数，排序作用于所有已发现目录；无项目保留在前，新发现项目按原顺序追加，失效路径不显示。标题右侧独立手柄通过 Pointer Events 支持触摸与鼠标，保留标题折叠；拖动显示插入位置并在边缘自动滚动。点击手柄提供上移、下移按钮，方向键可调整顺序。

**技术栈：** React、TypeScript、Vitest、Playwright、GitHub Actions、iOS Ad Hoc OTA。

## 任务 1：失败回归

- [x] 新建 `tests/ui/project-order.test.ts`：验证已有顺序、目录去重、未知/失效目录、新发现目录、无项目固定、后端隔离和损坏本机存储。
- [x] 扩展 `tests/ui/thread-list-page.test.tsx`：验证触摸手柄拖动提交完整目录顺序，取消/关闭不提交，点击标题仍折叠，方向键与上移下移能排序，搜索时不显示排序入口。
- [x] 在 `tests/e2e/mobile.spec.ts` 添加协议模拟场景：真实浏览器拖动后确认边栏顺序，打开新聊天确认 `<select>` 顺序，再 reload 确认顺序保留。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/project-order.test.ts tests/ui/thread-list-page.test.tsx`，确认新增回归因功能缺失失败。

## 任务 2：实现与验证

- [x] 新建 `src/features/threads/project-order.ts`，实现 `applyProjectOrder(directories, order)`、`moveProject(directories, cwd, targetCwd, placement)` 和按后端隔离的读写函数。
- [x] 新建 `src/features/threads/use-project-reorder.ts`，封装手柄 Pointer Events、拖动目标、取消、点击抑制和边缘滚动；回调仅在结束且顺序变化时提交。
- [x] 修改 `src/App.tsx`：在 `ConfiguredApp` 读取顺序，排序回调写本机存储并更新 React 状态；向当前边栏和每个 `BackendWorkspace` 传入各自顺序；新聊天 `projectOptions` 用共享函数排序。
- [x] 修改 `src/features/threads/ThreadListPage.tsx`：使用共享顺序展示项目；无项目、全部机器视图与搜索不参与拖动；新增手柄与单指操作按钮。
- [x] 修改 `src/styles.css` 与 `src/i18n.tsx`：44px 手柄、拖动背景及插入线；只在手柄禁用触摸滚动，补充英文标签。
- [x] 运行上述单测及 `tests/ui/sidebar-swipe.test.tsx`、`tests/ui/sidebar-refresh.test.tsx`、`tests/ui/thread-list-model.test.ts`，预期通过；运行 `npm run build`。
- [x] 运行 `PLAYWRIGHT_CHANNEL=chromium HOST=127.0.0.1 PORT=4173 CODEX_APP_SERVER_MODE=external CODEX_APP_SERVER_URL=ws://127.0.0.1:19999 npx playwright test tests/e2e/mobile.spec.ts -g '项目拖动排序同步新聊天并保留'`，预期通过。

## 任务 3：提交与固定渠道交付

- [ ] `git diff --check`，按中文 Conventional Commits 提交、集成 main 并推送，保留其他任务变更。
- [ ] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，读取 Android/iOS/OTA 当前版本，分配更高统一版本。
- [ ] 对已推送 main 执行 `gh workflow run build-android.yml -f release_version=<版本>`，下载 `CodexMobile-android`。
- [ ] 使用 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <版本> --notes '项目拖动排序同步新聊天项目列表'` 构建、签名与发布固定 IPA、HTTPS OTA。
- [ ] 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes '项目拖动排序同步新聊天项目列表'` 发布 APK。
- [ ] 两端固定 JSON、HEAD、完整 GET 核对版本、大小、SHA-256，核对内嵌前端一致；交付固定 OTA/APK/IPA 链接和实际元数据。
- [ ] 本次使用模拟传输，不创建真实测试会话；清理无用临时文件，归档 worktree。


## 验证记录

- 新增列表回归先因不存在排序手柄失败；顺序模块初次运行因尚未创建失败。实现后相关 5 文件、70 项测试通过。
- 排序手柄的横向触摸先复现边栏关闭，排除手柄后通过；未识别项目分组先复现被遗漏，保留空路径分组后通过。
- `npm run build` 类型检查和生产构建通过；保留仓库既有的大 chunk 提示。
- Playwright 真实触摸、鼠标拖动、新聊天同步、reload 持久化、长列表边缘自动滚动与 Escape 取消通过，1 项用例、2.9 秒。测试首次失败源于 reload 后边栏默认已打开，重复点击其背后的按钮；长列表检查补充等待打开动画稳定后通过。
- 浏览器截图检查：手柄、拖动高亮、插入线与底部操作区显示正常。本次仅使用协议模拟，没有创建真实测试会话。
