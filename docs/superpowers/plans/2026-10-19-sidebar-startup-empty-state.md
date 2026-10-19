# 冷启动边栏空态修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 启动或项目初始读取未完成时保持加载态，成功确认空数据后才显示暂无会话。

**Architecture:** 将既有业务导航加载状态经NativeNavigation/NativeRuntime/NativeSnapshot传递至Swift；项目pending状态由业务投影明确表达，保留搜索与失败处理。

**Tech Stack:** React、TypeScript、Vitest、SwiftUI、Swift smoke、XCTest。

## Task 1：状态链路与TDD（独立实现及两阶段审查）

**Files:** `src/App.tsx`、`src/native-ui/protocol.ts`、`runtime.ts`、`projection.ts`；`mobile/ios/NativeUI/NativeSnapshot.swift`、`mobile/ios/AgentUI/Session/AppSession.swift`及`AppSession+Projection.swift`。测试真实App导航接线、runtime、导航投影、Swift生产DTO与会话投影。

- [ ] 补真实App挂起目录/优先摘要/普通列表请求测试，逐次检查公开快照；首次查询前及空优先摘要返回后不能发出错误ready-empty。另覆盖成功空列表、失败/重试、搜索与已有数据。
- [ ] 补runtime及Swift回归：未就绪、普通navigationLoading=true、ready空/失败及搜索状态必须区分。先运行定向测试确认旧实现失败。

```ts
expect(snapshot.navigationLoading).toBe(true);
expect(projectGroup.loading).toBe('loading');
```

- [ ] 最小修复导航布尔字段透传与首帧默认加载；明确项目缺少首轮状态时的pending，避免空优先摘要提前结束整体加载；保留真实错误与旧内容。
- [ ] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/native-ui-runtime.test.ts tests/ui/native-ui-projection.test.ts tests/ci/agent-session.test.ts`及实际App回归，验证GREEN；`npm run typecheck`。
- [ ] 自审提交推送，再独立规格审查、代码质量审查；修复具体发现后复核。

## Task 2：模拟器与交付

**Files:** `mobile/ios/AgentAppUITests.swift`（冷启动立即展开的定向用例）；`docs/interaction-alignment.md`、本计划及脱敏验收记录。

- [ ] 新增只读真实App UI验收：终止后启动，首个“会话列表”按钮可用即点开，确认加载阶段无全局错误空态并最终出现会话，不创建或发送会话。
- [ ] 全量Vitest、typecheck和前端构建通过；生成并构建模拟器Debug，不构建发布包。
- [ ] 取得模拟器锁，在iPhone17Pro/iOS27、正常字号、竖屏运行定向UI用例；核对真实空项目与搜索/失败回归，完成后释放锁，保留无探针修复版本。
- [ ] 更新交互现行要求、验收要点和变更记录，区分已验证/未发布；提交推送并核对远端SHA，不发布或部署。
