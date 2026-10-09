# 移除原生界面并恢复网页实现计划

> **For agentic workers:** Use superpowers:executing-plans 按以下顺序执行。回退为同一条连续工作流，不拆分源码写入。

**Goal:** 删除本轮 iOS 原生对话、边栏及切换实现，网页恢复原生化前的已发布实现，保留无关通知修复，并发布同版本双端安装包。

**Architecture:** 以 `6dc2607` 为界面基线，通过 Git 恢复仅界面改动的文件。`src/App.tsx` 和 README 仅反向应用界面补丁，保留 `585045a` 的隐藏辅助会话通知修复。WKWebView 容器、附件选择、更新、链接浏览器、键盘修复、OTA 签名流程沿用既有实现。

**Tech Stack:** React/TypeScript、WKWebView/SwiftUI 容器、Vitest、Python iOS 回归、Xcode、既有 APK 与 Ad Hoc OTA 发布。

## 1. 范围与回归

- [x] 复用本任务 clean worktree，新建 `revert/native-and-web-ui` 分支，检查 `6dc2607..HEAD` 的所有路径和重叠通知修复。
- [x] 新增 `tests/ui/web-only-rollback.test.tsx`，让旧原生偏好和迟到原生事件不覆盖网页草稿、搜索及会话操作；运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/web-only-rollback.test.tsx` 记录预期失败。
- [x] 恢复 `.github/workflows/build-ios.yml`、`scripts/configure-ios-tests.rb`、`index.html` 和 UI 改动路径到 `6dc2607`。用 `git show --format= fedfb21 -- src/App.tsx` 等界面提交补丁逆向应用 App/README 部分，保留 `onThreadMetadata` 与隐藏通知说明。
- [x] 确认 NativeConversation/NativeSidebar/NativeMarkdown、React 原生 hook、界面切换设置、优化 CSS 及失效专用测试已删除；界面路径与基线逐字相同，剩余客户端差异仅为无关通知修复和新回归。

## 2. 验收与文档

- [x] 运行新回归确认 green，再运行全量 Vitest、`npm run build`、`python3 -m unittest discover -s tests/ci -p 'test_ios_*.py'`。
- [x] 恢复 README 当前能力及 `docs/ios-simulator-verification.md` 的网页流程，删除失效的原生/网页比较文档、历史实施计划和设计规范，记录本次回退。
- [x] 独占 `.mobile-build/.ios-simulator.lock`，重新生成 iOS 工程；构建与启动真实模拟器，检查网页边栏、会话、输入与键盘。只读历史/未发送草稿，测试会话若创建立即归档。

## 3. 提交与发布

- [ ] 阅读提交规范，`git diff --check` / 暂存检查通过后，中文 Conventional Commit，合并推送 main。
- [ ] 独占 `.mobile-build/.fixed-channel-publish.lock`，读取两端固定清单与 OTA 选择更高统一版本。推送后运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <version> --notes '移除原生界面，恢复原网页对话与边栏'`。
- [ ] 使用 `.github/workflows/build-android.yml` 的固定模板、构建步骤生成同版本 APK；两端固定渠道发布并验证 JSON、HEAD、完整GET大小与 SHA-256、iOS 独立验签和身份连续性。
- [ ] 保存安装包、截图和日志到主工作区 `.mobile-build/ui-rollback-audit/`；清理任务临时缓存、网关、测试 Runner并释放两类锁；归档未受保护的本任务工作树。
- [ ] 记录发布元数据并提交推送文档，最终回复展示固定 OTA、APK/IPA 链接、统一版本、各自大小及 SHA-256和 IPA签名状态。

阶段验收：界面专属73个路径逐字恢复 `6dc2607`；独立审查通过。825项Vitest/92个文件、87项Python、前端构建通过。iPhone 17 Pro / iOS26.5两项旧网页UI用例通过，覆盖底部安全区、聊天按钮、草稿输入、反复收键盘与几何动画。未发送任何测试消息。固定发布锁下读取双端及OTA均0.2.134，本次统一版本选择0.2.135。
