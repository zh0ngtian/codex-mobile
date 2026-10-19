# 冷启动边栏优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除额度前台占用和无项目全局扫描，保留每组最近5条与按需加载，模拟器重测30次。

**Architecture:** 复用现有background优先级及thread/read轻量摘要；已知无项目候选按元数据排序后截取，不查全局thread/list。Swift投影复用既有项目分组动作，真实无项目会话project仍为nil。

**Tech Stack:** TypeScript、React、Vitest、SwiftUI、Swift smoke、XcodeBuildMCP。

## Task 1：额度调度与无项目定向分页（独立实现及两阶段审查）

**Files:** 修改`src/backends/workspace-bootstrap.ts`、`src/app.tsx`、`src/app-server/thread-list-loader.ts`；测试`tests/ui/workspace-bootstrap.test.ts`、`tests/ui/http-request-priority.test.ts`、`tests/ui/thread-list-loader.test.ts`，必要的既有调用夹具随接口更新。

- [ ] 先补真实HTTP调度回归：调用runWorkspaceBootstrap，loadThreads经同一个AppServerClient以background发thread/loaded/list，额度回调接收调度选项并保持未完成，完成列表后关键初始化必须返回。

```ts
loadRateLimits: (options) => client.request('account/rateLimits/read', undefined, options).then(() => undefined)
```

- [ ] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/workspace-bootstrap.test.ts tests/ui/http-request-priority.test.ts`，确认新断言因额度仍占前台而失败。
- [ ] 给WorkspaceBootstrapTasks额度回调传入`{priority:'background'}`，app回调将该options传给真实request，不改全局调度器。
- [ ] 先补无项目行为测试：输入乱序ID、recencyAt与updatedAt相反、超过5个正常候选、归档路径及显式归档、子会话、确定不存在ID、普通网络错误、置顶排除。断言只调用thread/read且includeTurns为false，前5与前10有序，hasMore正确，真正错误不退回全局读取。
- [ ] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/thread-list-loader.test.ts`，确认新断言在全局扫描实现失败。
- [ ] 以定向摘要替换全局页循环，去重输入、保留现有来源过滤，去掉turns，应用归档过滤和稳定时间排序，再slice到目标数量。缺失错误只在确定为不存在时跳过；其他错误交给既有项目错误处理。
- [ ] 重跑相关测试及typecheck；自审后按中文提交规范提交实现。
- [ ] 独立规格审查通过后，进行独立代码质量审查并修复发现的问题。

## Task 2：原生无项目分组及分页

**Files:** `mobile/ios/AgentUI/Session/AppSession+Projection.swift`、`tests/ci/agent-session-smoke.swift`。

- [ ] 修改Swift smoke：无项目组必须出现在scopedProjects，projectMembers包含该会话，projectConversations能够返回会话，真实会话project仍为nil，projectHasMore与loadMoreProject派发既有project.more及真实cwd参数。
- [ ] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci/agent-session.test.ts`，先确认旧排除条件失败。
- [ ] 让category=project的无项目组进入现有projectGroups/scopedProjects投影；用command中的cwd识别无项目，因为group.cwd可能为空字符串；不改真实会话project归一化。

```swift
let groupCWD = group.command.flatMap { string($0.params["cwd"]) } ?? group.cwd
let projectless = groupCWD == "codex-mobile://projectless"
if group.category == "project" { /* 复用原有分组投影 */ }
```

- [ ] 重跑Swift smoke及相关UI契约测试，核对无项目标题、加载更多和分页动作。

## Task 3：集成、模拟器采样及交付

**Files:** 同步`docs/interaction-alignment.md`、本计划；新增`docs/performance/2026-10-19-sidebar-startup-optimized/`及文档索引入口。

- [ ] 全量`NODE_OPTIONS=--no-experimental-webstorage npm test`、`npm run typecheck`，检查全部结果。
- [ ] 用当前源码生成iOS工程，只构建模拟器Debug；取得同一iPhone17Pro模拟器锁后安装。正常字号、竖屏验证无项目分组、加载更多与普通项目5条分页；不新建或发送会话。
- [ ] 复用基线的临时安装包副本计时探针；保留相同起点、终点、配置及缓存策略，先校准，随后固定30次。记录额度、定向摘要、列表RPC和错误计数；不使用全局thread/list。
- [ ] 独立复算P90/P95；与基线分开标注，保存样本/事件/环境散列和限制。恢复无探针修复构建并核对散列，关闭收集器及释放锁。
- [ ] 独立最终审查，`git diff --check`，提交、推送分支并核对远端SHA。按用户要求不发布或部署。
