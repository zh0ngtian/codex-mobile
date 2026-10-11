# 编辑结果逐文件统计实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话执行，遵循 TDD；按仓库约定提交、推送及双端固定渠道发布。

**目标：** 完成编辑后直接显示文件路径与各自增删行数，保留总改动统计及 Diff 查看入口。

**架构：** 复用 fileChange 的 changes 与 summarizeFileChange；完成回复默认露出文件修改活动，其余过程继续折叠。每个编辑记录显示汇总与文件按钮，点击对应文件打开该文件 Diff。

**技术栈：** React、TypeScript、CSS、Vitest、Playwright。

## 任务 1：回归与实现
- [x] 独立 worktree 基线：`npm test -- tests/ui/conversation.test.tsx tests/ui/tool-sheets.test.tsx`，69 项通过。
- [x] 在 `tests/ui/conversation.test.tsx` 添加完成回复默认显示多个文件、零增删值和点击第二个文件定位的测试；先运行确认失败。
- [x] 修改 `src/features/conversation/Timeline.tsx`：文件活动显示逐文件按钮，复用 `summarizeFileChange(change)`，完成回复的展开白名单包含 `fileChange`。
- [x] 修改 `src/features/conversation/sheets/ToolSheets.tsx`：接收 `initialFileIndex = 0` 并用其初始化展开文件。
- [x] 修改 `src/styles.css`：文件行使用 `minmax(0, 1fr) auto`，路径 `overflow-wrap: anywhere`，统计 `white-space: nowrap`，触控高度至少 44px。
- [x] 运行上述测试、`npm run build` 和移动端相关 Playwright；检查小屏、横屏、长路径、点击定位与总数。

## 任务 2：提交与交付
- [x] `git diff --check`；按中文 Conventional Commits 提交并推送 main。
- [x] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，读取 Android/iOS/OTA 清单，分配更高统一版本。
- [x] `gh workflow run build-android.yml -f release_version=0.2.140`；下载 `CodexMobile-android` 并发布固定 APK。
- [x] `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version 0.2.140 --notes '编辑结果显示每个文件的增删行数'`。
- [x] 双端固定 JSON、HEAD、完整 GET 校验版本、大小与 SHA-256；提供固定 OTA/APK/IPA 链接与签名状态。清理临时验证文件。

## 实施验证
- 逐文件回归先因缺少文件按钮失败，再通过；相关 Vitest 70 项通过。
- `npm run build` 通过；沿用已有大 chunk 提示。
- 独立 Playwright 文件编辑场景通过：375px 小屏、812px 横屏、长路径换行、44px 触控高度、第二文件定位和总数一致。截图人工检查通过。
- 旧综合移动端用例在本次文件统计断言之前因 `user.png` 图片不可见失败；未改动无关图片实现。默认 Chrome 未安装，使用现有 Chromium 验证。
- 使用协议模拟数据，没有创建真实测试会话。

## 交付记录
- 实现提交：`5de352c`，已推送 main；双端构建运行： https://github.com/zh0ngtian/codex-mobile/actions/runs/38029839472 。
- 独占固定渠道锁后分配统一版本 `0.2.140`，高于原两端 `0.2.139`。
- 固定 APK：`4,708,523` 字节；SHA-256 `70b1ce73877e9a50e2d8435ce085404d5fe2b001299685bd2cf15ffbe0f8a792`。
- 固定 IPA：`3,773,294` 字节；SHA-256 `8389db0fbf8c9e59425ada0bc5860af61b8b5ab342fc258184473cbaf7445e70`；Ad Hoc 已签名，独立归档验签通过，Bundle ID、签名 application-identifier 与钥匙串组保持原有身份。
- 固定 JSON、HEAD、完整 GET 与本机产物一致；HTTPS 使用配置中的 CA 校验，安装页版本正确。
- 两端内嵌前端 SHA-256 相同：`45a831c8fafeb450854ec670e6b5a1470d4c66a29c59b812f2fefdd34385a2d1`。
- 验证截图与下载校验记录保存在主工作区忽略目录 `.mobile-build/per-file-stats-0.2.140/`。未进行真机覆盖安装与数据保留验证。
