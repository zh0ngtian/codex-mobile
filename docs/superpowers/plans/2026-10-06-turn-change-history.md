# 回合改动统计恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking。

**Goal:** 恢复会话 `01a10be8-1507-7533-9a04-8a94dbe3f050` 的 +1679/-69，并防止命令行修改、子 Agent 修改和提交后的历史统计丢失或误报 0。

**Architecture:** 网关共享 `TurnChangeHistory` 服务，回合开始前捕获独立 Git index 对应的工作目录树，结束后比较树并原子保存增删数字，不修改用户工作目录或 index。读取历史时优先使用保存的快照，再使用完整回合 diff；缺失时只从成功命令输出中明确的 Git commit 记录恢复，校验提交时间属于回合。HTTP 和 WebSocket 使用同一服务；客户端保留 unavailable 状态，不把完整历史里的命令执行误算为 0。

**Tech Stack:** TypeScript、Node.js fs/child_process、Git、React、Vitest、Playwright、Android。

---

用户已确认使用计划与 TDD 流程。共享状态与发布由主 Agent 完成；独立统计模块委派实现，随后分别做规格与质量审查。

### 任务 1：统计来源与共享历史服务

**Files:** 新增 `server/turn-change-history.ts` 和 `tests/server/turn-change-history.test.ts`；修改 `server/turn-details.ts`。

- [x] RED：真实临时 Git 仓库断言快照前后命令写入并提交后仍得到 +2/-1，重新创建服务仍读取同样数字，index 字节不变。
- [x] RED：旧回合包含 `[main abc1234] fix: ...` 成功命令输出，验证该提交的时间、去重并恢复其 numstat；失败命令、仅 mention hash、时间越界、非 Git 目录必须返回 null。
- [x] RED：缺 diff 且存在 commandExecution 时 compactTurnDetails 返回 `changeStatsUnavailable: true`、不返回 loadedChangeStats；纯文字完整回合可确定为 0，空 unified diff 可确定为 0。

```ts
const history = new TurnChangeHistory(codexHome);
await history.beforeStart(threadId);
history.observe({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
// 写入并提交真实 Git 文件后：
history.observe({ method: 'turn/completed', params: { threadId, turn: { id: turnId } } });
expect(await history.get(threadId, { id: turnId, status: 'completed' })).toMatchObject({ additions: 2, deletions: 1 });
```

- [x] 运行 `npx vitest run tests/server/turn-change-history.test.ts --maxWorkers=1`，实际观察失败。
- [x] GREEN：提供 `beforeStart(threadId, cwd?)`、`observe(message)`、`get(threadId, turn)`、`flush()`；所有 Git 参数用 execFile，设 timeout/maxBuffer。路径从真实 thread metadata/rollout 获取，统计缓存放在 codexHome/codex-mobile-turn-changes；并发通知去重、同回合开始不覆盖基线、失败不阻塞 RPC。来源为 snapshot 或 commit，保存数字和基线树，统计缺失返回 null。
- [x] GREEN：compactTurnDetails 接受回合统计 map；显式 unknown 优先于默认 0，已有真实 diff 与图片回填保持正常。
- [x] 定向测试通过后执行规格审查，再执行质量审查；修复所有问题后复查。

### 任务 2：网关接入与客户端缺失状态

**Files:** 修改 `server/gateway.ts`、`server/http-session.ts`、`src/ui/conversation.tsx`、`src/app-server/thread-session.ts`、`tests/server/http-session.test.ts`、`tests/ui/thread-session.test.ts`、`tests/ui/conversation.test.tsx`。

- [x] RED：HTTP details 读取持久统计覆盖缺少 fileChange 的回合；原始实时 diff 未截断前持久保存。UI 回填 unknown 后只显示“统计不可用”，图片仍正常回填。

```ts
expect(applyTurnChangeStats([{ id: 'turn', itemsView: 'summary', items: [] }], {
  turn: { images: [], unavailable: true },
})[0]).toMatchObject({ changeStatsUnavailable: true });
expect(hasTurnChangeStats({ itemsView: 'full', changeStatsUnavailable: true, items: [] })).toBe(false);
```

- [x] 运行 `npx vitest run tests/server/http-session.test.ts tests/ui/thread-session.test.ts tests/ui/conversation.test.tsx --maxWorkers=2`，确认新增断言失败。
- [x] GREEN：gateway 创建唯一服务传给 HttpSessions，回合 start 前等待 beforeStart；通知 observe 在 bounded 前执行。details 对每个回合调用 get 并传给 compactTurnDetails。WebSocket 透传同时关联请求/响应元数据与通知，保存统计，保持消息顺序和 id。客户端 TurnBackfill 支持 unavailable，apply 时不设置虚假的 loadedChangeStats。
- [x] 聚焦验证通过后审查整个修复。

### 任务 3：实际会话验收与交付

**Files:** 更新 `README.md` 和本计划，证据放仓库外 `../codex-mobile-proof/turn-change-history`。

- [x] 全量 79 个测试文件、633 项通过；`VITE_APP_VERSION=0.2.78 npm run build:package` 与 `git diff --check` 通过。Node 26 测试指定 `NODE_OPTIONS=--localstorage-file=/tmp/codex-turn-history-tests.storage`。
- [x] 只读 RPC 恢复原会话最近回合 +1679/-69，重建服务后保持；浏览器看到“本次代码改动 1748 行”，重新打开保持一致，未发送新消息。
- [ ] 新 APK 在真机上打开原会话并验证“本次代码改动 1748 行”。
- [ ] 按 docs/commit-conventions.md 提交，合入 main 并推送；GitHub Build Mobile Apps 构建高于当前固定渠道的 APK，安装到手机验证。
- [ ] 更新本机网关，发布固定渠道，核对 JSON、HEAD、GET 的版本、大小和 SHA-256。
- [ ] 交付固定 APK 地址，清理本次不再需要的临时文件与隔离工作树。

## 提交前验收记录

- 规格审查和最终质量复审均 PASS，无剩余阻断。
- 额外 RED→GREEN 覆盖截断 diff、失败/未发送请求清除基线、无关通知不写缓存，以及 `git add -f` 与字面路径匹配。
- 浏览器证据位于仓库外 `codex-mobile-proof/turn-change-history/browser-proof.json` 和 `browser-counts.png`。
- 提交之后的 APK 构建、真机验证、固定渠道发布与文件校验结果统一记录在同目录 `delivery.json`，以实际结果为准。
