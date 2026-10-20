# 用户消息重复气泡修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iPhone 17 Pro 模拟器稳定复现一次发送产生两个用户气泡，并修复本地临时消息与正式消息的对账。

**Architecture:** 保留现有 App、网关协议和原生投影。仅在消息合并时确认并移除同一回合已获正式消息确认的 `local-*` 副本，保留附件与所有正式用户消息；不按正文全局去重。使用测试专用传输夹具控制回执、稀疏摘要和过程回填时序，经过真实 React 业务、桥接和 SwiftUI 呈现验证。

**Tech Stack:** TypeScript、Vitest、React、WKWebView、SwiftUI、XCTest、iOS 27 模拟器。

---

### 1. 复现与回归（先红）

**Files:** `tests/ui/user-message-reconciliation.test.ts`、`mobile/ios/UserMessageReconciliationUITests.swift`、`tests/fixtures/user-message-reconciliation/`。

- [x] 在独立 worktree 核对现行约定；相关 3 文件 150 项基线通过。
- [x] 添加运行回填早于用户消息事件的最小回归：

```ts
const started = applyTurnStarted(pendingThread, { threadId, turn: { id: turnId, status: 'inProgress', items: [] } });
const recovered = applyTurnCommentary(started.turns, { turnId, items: [confirmedUser], messageOrder: [confirmedUser.id] });
expect(projectConversation({ id: threadId, turns: recovered }, path => path).filter(message => message.role === 'user')).toHaveLength(1);
```

- [x] 执行 `npm test -- tests/ui/user-message-reconciliation.test.ts --maxWorkers=1`，确认因两个气泡而失败，保存日志。
- [x] 通过测试专用网络夹具重放一次发送、稀疏摘要和正式用户回填；iPhone 17 Pro、正常字号、竖屏截图确认两个气泡，保存相同 UI 用例的失败证据。

### 2. 消息确认与残留收敛（再绿）

**Files:** `src/app-server/thread-session.ts`、`src/ui/conversation.tsx`，必要时提取专门负责本地用户确认的共享小函数。

- [x] 只关联同一回合的本地临时消息与正式用户消息，保留正式消息 ID；回填缺少附件时保留原本地附件。
- [x] 已存在正式/本地两份时，后续摘要对账也应清除已确认的本地副本；不可删除其他插话、真实相同正文、不同附件或未确认发送。
- [x] 覆盖实时事件先到/后到、重复回填、标题内部包装、附件及两次真实相同文字；执行定向回归与 `npm run typecheck`。
- [x] 同一模拟器 UI 用例由失败转为通过，补验刷新/重开及真实相同正文两次发送的气泡数量。

### 3. 验证与交付

**Files:** `docs/interaction-alignment.md`、本计划、本机 `.mobile-build/user-message-dedup/` 证据。

- [x] 同步现行发送要求、验收要点、变更记录与实现/模拟器/发布状态。
- [x] 完成相关测试、必要客户端构建及审查；本轮仅有合成会话，没有远端测试会话需要归档；已关闭夹具服务与本任务独立模拟器。
- [x] 遵守中文 Conventional Commits，修复提交`12529315663da81a78e8b8e5076faf5a3052aaa2`已推送到`codex/user-message-dedup-20261020`。
- [ ] 正式发布范围经用户确认后，按协调入口完成后续批次，记录真实状态，不把分支推送当成已发布。

## 调查证据

用户样本会话 `01a15219-0500-7680-a14c-e8e07108c345` 最新轮发送回执、实时事件、summary/full/commentary 均只有一个正式用户消息。旧合并函数的独立复现显示 `local-*` 与正式 ID 共存，并在后续摘要对账中继续保留；该轮手机内部具体时序尚未捕获，模拟器采用上述受控顺序验证可达路径。

## 已取得的验证证据

- 旧版原生UI断言在 `.mobile-build/user-message-dedup-red-5.xcresult` 明确失败为“2不等于1”；`.mobile-build/user-message-dedup-before.png` 可见两个相同用户气泡，夹具计数只有一次发送与一次回填。早先三轮设备引导以及等待进度文字的失败仅用于完善夹具，不作为缺陷红证据。
- 第一轮修复版 `.mobile-build/user-message-dedup-green.xcresult` 完整用例通过：一次发送1条、两次同文2条、重启重开2条。最终源码加入审查补出的迟到摘要修复后，正在执行 `.mobile-build/user-message-dedup-final.xcresult`。
- 专项最初48项中30项失败、18项通过；审查再增加2条完成后旧摘要的回归，先失败再修复，最终专项50项通过。8文件281项定向回归与类型检查通过；两个历史编辑夹具仅修正发送seed，与completed正式首用户保持一致，全部原编辑/附件/引用断言保留，并在隔离旧源码中通过。
- Node 26运行全量时采用现有CI的 `NODE_OPTIONS=--no-experimental-webstorage`，避免实验性全局localStorage遮蔽jsdom。未设参数的初始化失败不作为业务回归；正确参数下暴露的2处不一致夹具已修正，最终全量正在运行。
- 现有发布适配器212项、协调器恢复59项通过。跨ID pending回合的文字/图片认领保持基线；本轮只修复同一已确定回合内的消息确认，不扩大已有跨回合匹配契约。空正文且所有附件身份都缺失时不猜测对应输入，等待后续带身份的数据。
- 质量审查用真实输入工厂补出“图片+Skill/插件”组合：主聊天乐观消息没有指令片段，正式消息却有；Sidechat完整输入经过程回填后也可能省略指令，旧身份计数会拒绝确认。新增真实构造回归先红，再仅排除已知`skill`/`mention`的身份比较，同时处理保留指令但省略图片的回填补图；未知片段继续比较。本轮最终验证须包含这项修复，前一次1773项全量及模拟器绿测属于审查前版本，不能替代最终结果。

## 最终验证与发布边界

2026-10-20最终源码已通过专项66项、8文件297项定向、全量157文件1789项（包含143项构建契约）、typecheck和前端构建；现有适配器212项、协调恢复59项通过。规格复审及质量复审通过，质量审查独立重放主聊天/Sidechat与指令保留/省略的12种组合全部收敛并保留图片。

`.mobile-build/user-message-dedup-delivery.xcresult` 最终原生UI用例52.312秒通过，覆盖一次发送1条、两次同文2条及重启重开2条；最终前端资源由本worktree正常Vite构建后进入隔离原生容器，没有测试逻辑进入生产源码。最终截图为`.mobile-build/user-message-dedup-after.png`、`-two-sends.png`、`-reopened.png`，修复前为`-before.png`。[结构化证据](evidence/2026-10-20-user-message-dedup.json)记录源文件与截图散列。

客户端协调任务已登记为`user-message-dedup-20261020`，尚未ready。当前main还包含上一个正式版本之后已合入、尚未发布的选文引用、附件格式、视频预览及首台设备引导等修改；正式发包会一同包含它们，按用户提供的“重要产品决定先确认”交互要求，待用户确认本轮正式发布范围后再提交ready。当前没有客户端正式安装包发布或网关部署，不把本地模拟器验收当成真机覆盖安装验收。
