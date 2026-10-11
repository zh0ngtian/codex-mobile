# 历史消息编辑焦点与手势实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话逐项执行；遵循 TDD，独立工作树开发，按仓库要求提交推送和双端发布。

**目标：** 点击编辑历史消息后立即聚焦输入区，光标位于文本末尾；编辑期间禁用左右滑动侧栏，退出后恢复。

**架构：** 保留原消息内编辑。编辑入口用 React DOM 的同步提交保留点击上下文，输入框挂载时聚焦并定位光标。侧栏手势检查当前可见工作区是否存在历史编辑器，在起始、移动、结束阶段统一阻断，并清除进行中的拖动。

**技术栈：** React、TypeScript、Vitest、Playwright、PakePlus、Ad Hoc OTA。

## 任务 1：回归与实现
- [x] 创建独立 worktree，安装依赖，运行侧栏与分页编辑基线。
- [x] 在 `tests/ui/conversation-page-pagination.test.tsx` 断言编辑框焦点与文本末尾光标；在 `tests/ui/sidebar-swipe.test.tsx` 覆盖左右手势禁用、恢复、拖动中进入编辑和隐藏工作区隔离。先运行确认因缺少行为失败。
- [x] 在 `src/App.tsx` 的 `beginHistoricalMessageEdit` 同步提交 `flushSync(() => setHistoryEdit(...))`，覆盖所有编辑入口；`src/features/conversation/Timeline.tsx` 稳定的 textarea ref 回调执行 `input.focus()` 与 `input.setSelectionRange(input.value.length, input.value.length)`。
- [x] 在 `src/features/threads/sidebar-swipe.ts` 为起始、移动、结束的条件加入当前可见编辑器检查：`document.querySelector('.backend-workspace:not([hidden]) .history-message-editor')`；移动或结束时沿用 `cancelDrag()`。
- [x] `npm test -- tests/ui/sidebar-swipe.test.tsx tests/ui/conversation-page-pagination.test.tsx tests/ui/conversation.test.tsx` 全部通过；`npm run build` 通过。
- [x] Playwright 使用模拟协议运行完整 App：点击编辑的事件结束时已聚焦、文本追加、左右手势不打开侧栏、取消后右滑恢复。无需发送真实消息。

## 任务 2：提交与发布
- [x] 阅读 `docs/commit-conventions.md`；`git diff --check`、暂存检查，中文 Conventional Commits 提交并推送 main。
- [x] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，读取 Android/iOS/OTA 当前版本，使用统一更高版本。
- [x] 按 `mobile/android/build-recipe.yml` 构建并发布固定 APK；`npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '历史消息编辑自动聚焦并禁用左右滑动'` 构建签名发布 IPA。
- [x] 读取 SignOs 最新 `PUBLISH_PROMPT.md`，使用同一已签名 IPA 更新 当前软件源（遵循上游迁移后的家中 HTTPS 发布），保留已有开发者并追加当前 GitHub 用户。
- [x] 双端固定 JSON、HEAD、完整 GET 核对版本、大小与 SHA-256；HTTPS OTA 与软件源回验，提供固定安装页及 APK/IPA 链接。
- [x] 清理本次无用临时文件；模拟协议无真实测试会话，保留交付证据后归档工作树。

## 实施记录
- 独立 worktree 基线 35 项通过；新增回归先出现 5 项预期失败，修复后相关 109 项通过。
- 浏览器完整 App 回归先证明光标在开头（输入变成“追加历史原文”），修复后焦点、末尾追加、左右滑动禁用、退出恢复与底部草稿保留均通过。
- 前端构建和类型检查通过；保留既有大 chunk 提示。
- Node 26 全量测试使用 `NODE_OPTIONS=--no-experimental-webstorage` 避免原生 localStorage 干扰 jsdom。限制 2 workers 后 871/872 通过，服务端空闲回收用例出现计时失败；独立复验该文件全部 48 项通过，未修改服务端代码。
- 通过 GitHub API 读取上游最新 main：`PUBLISH_PROMPT.md` 已迁移至 `distribution/app-source/`；上游要求使用私有环境中的家中 HTTPS 软件源及共享 token 上传器，旧 Cloudflare Worker 保持停用。按该最新流程交付，不更改本仓库发布脚本。

## 交付记录
- 实现提交 `eaec021` 已推送 main；在已推送的独立工作树构建。合入最新双指缩放修改后相关 134 项与浏览器回归通过；最新 main 也保留本次焦点与手势修复。
- 独占固定渠道发布锁后，基于双端及 OTA 原版本 `0.2.142` 分配统一 `0.2.143` / build `2143`。
- APK：4,709,731 字节；SHA-256 `a027964405693cb3a0f5a5a8222fab2bd75142970d1c085d857d9a97cfc969a5`；签名证书 SHA-256 与上一版一致。
- IPA：3,773,887 字节；SHA-256 `19a154b39986eb8e5a406df88f8d07fe33882822ca560b3535b8751d83542e61`；Ad Hoc 已签名，独立归档验签通过，原 Bundle ID、application-identifier 与钥匙串组保持连续。
- 两端固定 JSON、HEAD、完整 GET 版本、大小和 SHA-256 一致；HTTPS OTA manifest、安装页、固定入口回验通过。
- 上游最新 `distribution/app-source/PUBLISH_PROMPT.md` 指导的家中软件源上传返回成功；源清单、HEAD、完整 GET 与同一已签名 IPA 一致。当前 GitHub 用户为 `zh0ngtian`，既有开发者 `loock-ai / zh0ngtian` 原样保留。
- 两端内嵌前端 SHA-256 相同：`bc7ed8bc5efbbe686ee266aea3a4426f6e7262683a5f5240a12509494e221cad`，安装包中确认包含末尾光标定位逻辑。
- 安装包及证据保存在主工作区忽略目录 `.mobile-build/history-edit-focus-release/`。全部界面回归使用模拟协议，没有真实测试会话需归档；未执行真机覆盖安装与数据保留验证。
