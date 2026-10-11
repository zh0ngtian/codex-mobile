# 按回复阶段展示会话实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前隔离 worktree 逐项实施；此任务共享渲染与发布状态，不委派。

**Goal:** 执行中仅展示 commentary；收到 final_answer 后立即展示最终答复，将此前过程默认折叠且可展开。

**Architecture:** 保留原始 items，以每条用户引导切分显示段。每段独立判断明确 final_answer；未收到时只渲染助手过程文本，收到后复用过程折叠组件。仅无 phase 的历史助手消息允许最终回复兼容回退，commentary 不被误认为 final。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Playwright、GitHub Actions、现有 iOS Ad Hoc 发布脚本。

---

### 任务 1：回复阶段切换与回归

**Files:** `src/features/conversation/Timeline.tsx`、`src/ui/conversation.tsx`、`tests/ui/conversation.test.tsx`、`README.md`

- [x] 增加从 inProgress/commentary 到 inProgress/final_answer 再到 completed 的渲染测试；确认过程说明折叠、命令及 reasoning 不默认展示，手动展开和重新折叠有效。
- [x] 增加引导后新段继续显示 commentary、显式 commentary 不作为历史 final、文件改动折叠后仍能展开 Diff 的回归。
- [x] 运行 `npm test -- tests/ui/conversation.test.tsx`，确认新增断言因旧显示行为失败。
- [x] 在 `splitCompletedTurnResponses` 增加 `allowLegacyFinal` 选项，回退限定为无 phase 的 agentMessage：

```ts
if (allowLegacyFinal && finalIndex < 0) {
  for (let index = responses.length - 1; index >= 0; index -= 1) {
    if (responses[index]?.type === "agentMessage" && responses[index]?.phase == null) {
      finalIndex = index;
      break;
    }
  }
}
```

- [x] TurnCard 始终按用户引导分段渲染，组件接收 running；运行中的分段禁止 legacy final 回退。无 final 时渲染 userMessage 和 commentary/无 phase 助手文字；final 到来后复用现有折叠按钮，不等待 turn/completed。
- [x] 最终答复的过程区域默认关闭，不把 fileChange 或过程图片单独展开；所有原始活动仍能从过程区查看。无 final 的失败/结束回合保留 commentary 与可展开的工具过程。
- [x] 执行 `npm test -- tests/ui/conversation.test.tsx tests/ui/conversation-controls.test.tsx tests/ui/conversation-scroll.test.tsx tests/ui/realtime-conversation.test.ts` 与 `npm run build`，预期全部通过。
- [x] 使用本地浏览器验证 375px、小屏大字号、横屏与主题样式下的运行/最终/展开状态；更新 README 显示规则。

### 任务 2：提交与双端发布

**Files:** 现有 `.github/workflows/build-mobile.yml`、`scripts/release-ios.py`（仅运行，不修改）

- [x] `git diff --check`、`git diff --cached --check`；按提交规范提交并推送 main，来源提交以实际 Git SHA 为准。
- [x] 固定渠道发布排队；读取双端清单及 GitHub Release 最大版本，确定本次统一版本高于各渠道。GitHub Actions 构建 APK 与 unsigned IPA，并核对产物来源 SHA。
- [x] 用 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <实际统一版本> --notes '运行中仅展示过程说明，最终答复出现后默认折叠过程消息'` 构建、签名并发布固定 iOS/OTA 渠道；APK 使用既有 publish-channel 命令发布同版本。
- [x] 回验 APK/IPA 固定 JSON、HEAD、完整 GET 的版本、大小及 SHA-256，核对软件源对应 unsigned 版本；保存签名包和 ota-release.json 到仓库外长期目录。
- [x] 收尾保留必要证据，清理本次临时文件；交付提供固定 OTA 安装页、APK/IPA 链接、版本、实测大小及完整 SHA-256，明确 Ad Hoc 签名与真机安装验证边界。

## 开发验证记录

- 基线 conversation 80 项通过；新增与更新的 6 项断言先因旧渲染行为失败，随后修复。
- conversation、controls、scroll、realtime 共 101 项通过；TypeScript 和 Web 生产构建通过（已有大分块提示）。
- Playwright Chromium 和移动 WebKit 各 1 项通过，覆盖真实 HTTP 事件触发、inProgress 下 final 开始立即折叠、375px/横屏大字号、减少动态效果、工具过程展开与 Diff 定位；截图已检查。
- 测试仅使用浏览器协议模拟数据，没有创建需要归档的真实 Codex 会话；未占用共享模拟器，真机覆盖安装与数据保留未验证。
- 已取得主工作区固定渠道发布锁；原 APK/IPA/OTA 与 GitHub 最高版本均为 0.2.158，选定 0.2.159。iOS 签名连续性预检通过。

## 发布验收记录

- 功能提交 `d06b7eeae2faa00236b63dc4d23f4ebf3f7ec82a` 已推送 main；GitHub Actions `38158026347` 双端构建与 Release 成功，APK/unsigned IPA 的构建回执来源提交、版本、大小、SHA-256 与 GitHub 附件匹配。
- APK 与 Ad Hoc 已签名 IPA 统一为 0.2.159 / build 2159，固定 JSON、HEAD、完整 GET 回验通过；HTTPS 安装页与 OTA 清单通过本机 CA 验证。已签名包内置前端包含本次阶段判断代码。

| 产物 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| APK | 4,720,859 | `8454a5820df2260e4ef4e27d35322bae8820626e8dbc1e3b28117009f19af052` |
| Ad Hoc 已签名 IPA | 3,789,898 | `d766616e2192098313b68ec05871f875098a655166df5e323727c808b5c476f4` |
| GitHub unsigned IPA | 3,766,399 | `d9b7757665316a7bdf36ea786e5e916a1d405f9ad1d51b32ec7623d21a90c6eb` |

- 软件源普通/兼容清单均已同步同版本 unsigned IPA，版本/build/下载链接/大小/散列匹配 GitHub Release。当前 GitHub 登录用户名已包含在原开发者署名中，保持原值；未上传 Ad Hoc 签名包到软件源或 GitHub。
- 固定 [OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) 均已更新。
- 长期证据位于主工作区 `.mobile-build/commentary-collapse-release/0.2.159/`：双端包、unsigned 包、签名与 OTA 凭证、固定渠道和公开软件源验证、GitHub 发布与来源回执、开发验证摘要、构建日志和浏览器截图。本次未做真机覆盖安装与数据保留验证。
- 收尾清理本次临时文件、释放固定渠道锁并归档任务 worktree；没有真实测试会话需要归档。
