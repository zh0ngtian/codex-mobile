# 选中文字引用与 Sidechat 提问实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development 执行功能任务，并先规格审查、后质量审查。步骤以 checkbox 跟踪。

**Goal:** 实现选中文字后的“加入聊天”和“在 Sidechat 中提问”，按用户批准的 A 规则分叉，在 iPhone 17 Pro 模拟器验收，暂不发布。

**Architecture:** React 共享业务层拥有引用与各聊天的内存输入草稿，原生和网页只负责选区及卡片展示。沿用最近已结束回合的 ephemeral Sidechat 与现有网关内存恢复；引用保存实际选文快照和原始来源，发送使用已有文本输入，不增加第二套历史数据库。

**Tech Stack:** TypeScript、React、Vitest、SwiftUI、UIKit、XCTest、Codex App Server V2。

## 批准范围与边界

- 系统选文菜单保留复制，增加中文/英文两个动作；用户、助手、过程、代码及表格各自可选区域均接线。同消息正文跨段仍可选择，不跨消息拼接选区。
- 输入区引用卡片显示来源、两行摘要、展开全文及移除；可添加多条。两个动作均不自动发送，不改写既有正文及附件。
- A：新 Sidechat 继承最近已结束回合上下文，所选文字独立作为引用；运行中片段冻结为点击时快照，无已结束回合时明确报错。Sidechat 内只有加入当前聊天，不开放嵌套选文分叉。
- 主聊天及各 Sidechat 切换时内存保留文字、附件和引用；原生快照必须确认新状态后再聚焦。过期或关闭清理对应分支草稿和附件资源；分支内容不持久化。
- 正文与引用分开做技能/插件识别，引用文本不自动变成技能指令。发送、队列、重试均冻结同一引用；明确失败保留可恢复内容，待确认继续按原UUID对账。
- 仅模拟器构建/安装与临时测试服务；不创建发布任务、不ready、不推进main、不部署生产网关、不改版本与渠道。提交推送开发分支。

## 任务 1：完整功能与红绿回归

文件：新增 `src/features/conversation/message-quotes.ts`、引用卡片与选区组件，以及 `tests/ui/message-quotes.test.ts`；修改 `src/App.tsx`、`ConversationPage.tsx`、`Timeline.tsx`、输入序列化、`src/native-ui/{protocol,runtime,workspace-adapter,projection}.ts`；修改 `mobile/ios/NativeUI/NativeSelectableText.swift`、展示DTO及 `AgentUI` 消息、输入和会话桥。按职责添加小文件，避免扩大App.tsx职责。

- [x] 先写纯逻辑和真实App桥接失败测试并运行。核心行为示例：
  ```ts
  expect(snapshot.quotes[0].text).toBe('被选中的中文😀');
  expect(snapshot.draft).toBe('保留的问题');
  expect(rpcCalls.filter(call => call.method === 'turn/start')).toHaveLength(0);
  ```
  用既有 `tests/ui/native-ui-sidechat.test.tsx` fixture 发送选文命令，验证参数身份、旧context拒绝、A分叉点、主/分支草稿及失败恢复。纯逻辑覆盖显示文本与Markdown源码差异、多条、移除、冻结、引用中的@不触发技能。
- [x] 执行 `npx vitest run tests/ui/message-quotes.test.ts tests/ui/native-ui-sidechat.test.tsx`，记录预期缺失功能的失败，再实施共享数据与各端入口。
- [x] 原生以UITextView系统编辑菜单增加动作，传播稳定原始消息来源；不要把渲染偏移当Markdown源码偏移。输入引用随业务快照同步，通过ACK后触发焦点。
- [x] 为Swift真实DTO及菜单/卡片添加范围内测试；执行相关Vitest、Swift smoke及 `npm run typecheck`；按错误逐项修复。
- [x] 规格审查通过后做代码质量审查，全部重要问题修复并复审。

## 任务 2：模拟器与收尾

文件：新增 `mobile/ios/SelectionQuoteUITests.swift`；更新 `docs/interaction-alignment.md` 现行要求、验收点与记录，按实际行为更新README及桥接说明。

- [x] 排队独占主工作区 `.mobile-build/.ios-simulator.lock`。使用真实生产App页面，iPhone17Pro、正常字号、竖屏；先证明新增入口及行为断言在基线缺失，再运行修复构建。
- [x] 验证实际长按选文菜单、加入引用、展开/移除、多条、保留原问题与附件、选文进入Sidechat、不自动发送、返回恢复、分支间隔离、真实发送引用全文、失败/旧context逻辑回归及关闭清理。XCTest保存截图与xcresult。
- [x] 运行全量Vitest、typecheck、前端构建和iOS模拟器Debug构建；不执行设备IPA/APK构建。
- [x] 归档本次创建的测试主聊天，关闭测试分支；移除测试探针并安装正常构建，保留既有设备设置，释放模拟器锁。
- [x] 文档明确“模拟器已验证、待用户验收、未发布”。执行 `git diff --check` 与暂存检查，用中文Conventional Commit（正文含新增功能、主要修改）提交并推送 `codex/selection-quotes`。

## 执行证据

- [x] 基线测试、红绿回归、审查、模拟器和最终提交结果按实际完成补记。

- 基线：150 文件 1670 项通过；系统选文新增动作的基线断言预期失败。最终：153 文件 1707 项完整回归、typecheck 与前端构建通过；高负载并发超时后串行全量通过，未跳过用例或为重试修改生产代码。
- iPhone 17 Pro、iOS 27、正常字号、竖屏：四项新增界面用例、四项既有行为回归、一个真实 Sidechat 收发关闭用例分别通过，共九项。真实主聊天为只读状态，按约定仍允许选文分叉。引用原文和独立问题已核对实际 RPC；界面关闭后读取分支确认内存记录已移除。
- 专用设备已由正常设置界面删除，临时网关及自己的 app-server 已停止；测试主聊天已通过 Codex 应用归档入口归档。重新执行 ios:prepare 移除测试探针，正常 Debug 构建、安装及无测试参数启动通过，已打开模拟器供用户验收。
- 状态：模拟器已验证，待用户验收，未合入 main，未发布。代码保存在 `codex/selection-quotes`。机器可读测试集合、日志与截图路径见 [验收证据](evidence/2026-10-19-selection-quotes.json)。最终提交与推送结果以此分支 Git 记录为准。
