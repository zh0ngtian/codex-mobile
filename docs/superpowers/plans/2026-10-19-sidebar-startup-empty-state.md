# 冷启动边栏空态修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 启动或项目初始读取未完成时保持加载态，成功确认空数据后才显示暂无会话。

**Architecture:** 将既有业务导航加载状态经NativeNavigation/NativeRuntime/NativeSnapshot传递至Swift；项目pending状态由业务投影明确表达，保留搜索与失败处理。

**Tech Stack:** React、TypeScript、Vitest、SwiftUI、Swift smoke、XCTest。

## Task 1：状态链路与TDD（独立实现及两阶段审查）

**Files:** `src/App.tsx`、`src/native-ui/protocol.ts`、`runtime.ts`、`projection.ts`；`mobile/ios/NativeUI/NativeSnapshot.swift`、`mobile/ios/AgentUI/Session/AppSession.swift`及`AppSession+Projection.swift`。测试真实App导航接线、runtime、导航投影、Swift生产DTO与会话投影。

- [x] 补真实App挂起目录/优先摘要/普通列表请求测试，逐次检查公开快照；首次查询前及空优先摘要返回后不能发出错误ready-empty。另覆盖成功空列表、失败/重试、搜索与已有数据。
- [x] 补runtime及Swift回归：未就绪、普通navigationLoading=true、ready空/失败及搜索状态必须区分。先运行定向测试确认旧实现失败。

```ts
expect(snapshot.navigationLoading).toBe(true);
expect(projectGroup.loading).toBe('loading');
```

- [x] 最小修复导航布尔字段透传与首帧默认加载；明确项目缺少首轮状态时的pending，避免空优先摘要提前结束整体加载；保留真实错误与旧内容。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/native-ui-runtime.test.ts tests/ui/native-ui-projection.test.ts tests/ci/agent-session.test.ts`及实际App回归，验证GREEN；`npm run typecheck`。
- [x] 自审提交推送，再独立规格审查、代码质量审查；修复具体发现后复核。

## Task 2：模拟器与交付

**Files:** `mobile/ios/AgentAppUITests.swift`（冷启动立即展开的定向用例）；`docs/interaction-alignment.md`、本计划及脱敏验收记录。

- [x] 新增只读真实App UI验收：终止后启动，首个“会话列表”按钮可用即点开，确认加载阶段无全局错误空态并最终出现会话，不创建或发送会话。
- [x] 全量Vitest、typecheck和前端构建通过；生成并构建模拟器Debug，不构建发布包。
- [x] 取得模拟器锁，在iPhone17Pro/iOS27、正常字号、竖屏运行定向UI用例；核对真实空项目与搜索/失败回归，完成后释放锁，保留无探针修复版本。
- [x] 更新交互现行要求、验收要点和变更记录，区分已验证/未发布；提交推送并核对远端SHA，不发布或部署。

## 验证记录（2026-10-19，未发布）

核心实现提交为`6ce0c60`、`97c1b7d`、`f18b74a`；独立规格审查发现并复核修复了多设备提前空态与关注筛选丢失错误入口两处边界，质量审查通过。最终全量146文件1618项、typecheck、前端与模拟器构建通过。

正常冷启动3轮通过；仅本机生成资源将首次目录请求延迟8秒的受控重测3轮通过，其中2轮明确观察到全局加载再进入真实会话。原6秒观察窗口的一次受控轮未等到会话而判失败，扩至12秒后完成重测。UI为AX采样，不能作为逐帧证据；目录/摘要/分页分段、成功真空、失败/重试、搜索和静默刷新由确定性真实App与生产Swift链路测试补充。

模拟器已恢复正常无注入构建并无参数启动，前端64个资源、index和原生文件核对一致，锁已释放；未创建或发送测试会话，无须归档。本次未发布、部署或重跑性能分布。详情见[结构化证据](evidence/2026-10-19-sidebar-startup-empty-state.json)。
