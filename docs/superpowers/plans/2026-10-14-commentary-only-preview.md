# 过程说明独立展示与浅灰分隔线预览计划

> 执行：superpowers:executing-plans，在当前会话按 TDD 实施。用户要求完成后先预览，不发布、不提交 release ready、不推进 main。

**Goal:** 展开历史过程时只显示 commentary，并在相邻过程说明之间增加浅灰色分隔线。

**Architecture:** `CompletedResponseSegment` 从 final 前后记录中筛出 `agentMessage/phase=commentary`，展开入口仅统计这些消息。工具、reasoning、文件修改与原生媒体不进入展开区域。保持已有 final、用户插话、默认折叠和整轮用时；运行阶段保持现有正文筛选，对实际 commentary 同样加分隔线。以真实 `TurnCard` 配合示例数据创建本地交互预览。

**Tech Stack:** React、TypeScript、CSS、Vitest、Playwright、Vite。

### 任务一：过滤与分隔

文件：`src/features/conversation/Timeline.tsx`、`src/styles.css`、`tests/ui/conversation.test.tsx`。

- [x] 用完成回合的多条 commentary、工具、reasoning、原生图片与 final 构造回归，验证展开只显示 commentary，计数只包含 commentary；运行、final 后到达说明、无 commentary 也覆盖。
- [x] 执行相关测试并确认新增用例因现有混合记录计数而失败。
- [x] 最小实现：对白名单过程使用 `phase === "commentary"`，分别过滤 final 前后；渲染 commentary 包裹 `.commentary-message`，相邻节点使用 `border-top: 1px solid #e5e5e5` 和 18px 顶部间距。
- [x] 更新与本次新契约冲突的旧界面断言，工具和图片组件自身能力仍由独立组件验证。
- [x] 相关测试、类型检查和双浏览器验证。

### 任务二：交互预览与暂存

- [x] 在本 worktree 的忽略目录 `.mobile-build/commentary-preview/` 放示例入口，引用真实 TurnCard 和样式，提供运行/完成切换与真实展开按钮。
- [x] 本地 Vite 提供预览，生成折叠与展开截图，检查浅灰线、计数、窄屏、大字号及横屏溢出。
- [x] 以独立预览分支提交推送，不登记发布 ready，不修改正式渠道。保留预览 worktree 与服务，供用户检查；没有真实测试会话。


验收与预览状态：
- 原对话回归基线 83 项通过；新增三个用例先失败，再实现过滤、分隔与计数。
- 对话与实时合并回归 94 项通过；`npm run typecheck` 通过。
- final 阶段实际 App 的 Chromium、WebKit mobile 两项浏览器回归通过；真实 TurnCard 的运行、完成/折叠、完成/展开、375px 窄屏、横屏、大字号预览均验证。
- 分隔线计算样式为 `1px solid rgb(229,229,229)`，顶部间距 18px；工具记录不可见；final、用户插话、整轮用时与总改动统计保留。
- 额外媒体回归发现原版本已有“Codex 生成的视频直接在消息中提供预览播放”失败。临时恢复 HEAD 的 Timeline 后独立重跑，确认同一失败（其余14项通过）；未修改视频能力，未将此历史问题列作本次已修复。
- 预览入口位于本 worktree `.mobile-build/commentary-preview/`，由本地 Vite 4206 提供；使用真实 TurnCard 与样式、示例记录，不连接正式网关。截图与验证 JSON 在同一目录。没有真实测试会话。
- 用户要求先预览，不发布：仅推送独立预览分支，不推进 main、不登记或提交 release ready、不构建或发布 APK/IPA、不部署网关。worktree 与预览服务保留供用户查看。
