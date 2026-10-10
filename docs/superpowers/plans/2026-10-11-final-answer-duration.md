# 最终回答显示用时实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前独立 worktree 逐步实施，遵循 TDD。

**Goal:** 在最终回答下方显示整个逻辑回合的实际用时，包含不足一分钟的回合。

**Architecture:** 复用 `turnDurationMs` 和 `formatTurnDuration`；只将整轮用时传给最后一段最终回答，与完成时间同行并允许窄屏换行。缺失或无效用时不显示，运行中沿用实时计时，正文和复制内容不受影响。保留过程折叠栏现有超过一分钟显示用时的行为。

**Tech Stack:** React、TypeScript、CSS、Vitest、Playwright、PakePlus Android/iOS。

### 1. 回归验证和实现

- [x] 在 `tests/ui/conversation.test.tsx` 添加最终回答用时验证：无过程消息的短回合、零值、权威时间回退、缺失/无效值、运行中、多个最终回复与正文复制。
- [x] 运行 `npm test -- tests/ui/conversation.test.tsx`，确认新断言因界面缺少用时失败。
- [x] 修改 `src/features/conversation/Timeline.tsx`：将 `durationMs != null ? formatTurnDuration(durationMs) : null` 仅传给 `finalSegmentIndex` 对应的最终回答，渲染 `t("用时 {duration}", { duration })`。
- [x] 修改 `src/features/conversation/timeline-timestamps.css`：新增可换行的最终回答元数据行，用时单行、数字等宽、字号与完成时间一致。
- [x] 在 `src/i18n.tsx` 添加 `"用时 {duration}": "Duration {duration}"`，更新 README 移动端交互说明。
- [x] 运行 UI 回归、`npm run typecheck`、`npm run build`；使用手机宽度和大字号检查最终回答完成时间与用时的可见性、换行和复制按钮。

验证记录：基线 69 项通过；新增用时断言先出现 5 项预期失败，实现后相关 107 项通过；320/375/412 px、大字号 Playwright 通过。全量首次因 Node 26 实验性 webstorage 失败，禁用该实验功能后 877 项通过，1 项 HTTP 超预算快照测试受并发时序影响失败，单独复跑通过；限制 worker 并重基到当前 main 后全量 885 项通过，类型检查和构建通过。全部 UI 使用模拟传输，未产生真实测试会话。

### 2. 提交与交付

- [x] `git diff --check`，按提交规范提交中文 Conventional Commit，推送并合入主分支。
- [x] 串行取得发布锁，读取双端渠道版本；在本 worktree 构建更高统一版本 APK 和签名 IPA。
- [x] 使用现有固定渠道发布脚本发布 APK，使用 `npm run ios:release` 完成签名与 OTA/LAN 发布。
- [x] 读取 SignOs 最新 `PUBLISH_PROMPT.md`，将同一签名 IPA 发布软件源，保留既有开发者并按当前 GitHub 用户追加。
- [x] 对固定清单、HEAD 和完整 GET 校验版本、大小、SHA-256；交付 OTA 页和 APK/IPA 链接。清理临时文件；如产生真实测试会话则及时归档。

## 交付记录

- 实现提交 `f59545d` 已推送并合入 main；取得发布锁后同步最新已推送 main，在本任务 worktree 构建，保留已有缩放、编辑焦点、原生长按菜单及页面滚动修复。
- 相关 UI 回归最终 111 项通过；完整测试在实现与此前 main 集成阶段 885 项通过；类型检查、双端构建和 320/375/412 px 大字号浏览器验证通过。
- 取得主工作区固定发布锁后，基于双端与 OTA 原版本 `0.2.144` 分配统一 `0.2.145` / build `2145`。
- APK：4,714,335 字节；SHA-256 `b3dd917fbabf417908a910324cc64c065060f44f71e5d524786d455cab63c3c6`；签名证书与上一固定版本一致。
- IPA：3,781,750 字节；SHA-256 `bf8cdd368a14650a7f78934f331b8cd6480195eb3af2ecdb14e60e969b52766b`；Ad Hoc 已签名，原安装身份与钥匙串组连续性检查通过。
- 固定 Android/iOS JSON、HEAD、完整 GET 版本、大小、SHA-256 全部一致；HTTPS OTA 版本目录及固定入口回验通过。
- 上游最新版发布指南已迁移到 SignOs `distribution/app-source/PUBLISH_PROMPT.md`；按该指南将同一签名 IPA 发布到家中软件源。当前 GitHub 用户 `zh0ngtian` 已包含在开发者署名 `loock-ai / zh0ngtian` 中，保留原值；源清单、HEAD 与完整 GET 验证通过。
- APK 与 IPA 的前端入口 SHA-256 相同：`f7b29d1010a1c25aa474f38929bc40eceb1548346f10a5493f4fccf6f3b13530`；两端确认包含 `final-answer-duration`。
- 安装包、预览及回验凭证保存在长期主工作区 `.mobile-build/final-answer-duration-release/`。本次使用模拟协议，未产生真实测试会话；未执行真机覆盖安装与数据保留验证。
