# 项目重新展开恢复五条实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 项目折叠再展开后只显示最近五条会话，仍可点击“更多”每次继续显示五条。

**Architecture:** 在现有 ThreadListPage 中维护按设备与项目区分的展示上限，折叠时恢复五条。缓存数据和服务端分页游标保持现有生命周期；更多优先展开已缓存会话，缓存不足时沿用原分页回调。搜索仍展示全部命中，不重置正常列表上限；关注区和其他项目保持原行为。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、现有 releasectl。

---

### Task 1: 展示上限与行为回归

**Files:**
- Modify: `src/features/threads/ThreadListPage.tsx`
- Test: `tests/ui/thread-list-page.test.tsx`
- Modify: `README.md`（同步折叠再展开的五条规则）

- [x] 写交互回归：缓存八条普通会话，先显示全部已加载条目；通过项目标题折叠并更新 collapsedProjectKeys，再展开必须只显示前五条，后面三条不可见，即使 projectHasMore=false 仍显示“更多”；点击后重新显示八条，不请求服务端。重复折叠仍重置五条。
- [x] 运行 `npm test -- tests/ui/thread-list-page.test.tsx`，确认新测试因展开后八条仍显示而失败。
- [x] 最小实现以下展示逻辑（命名可依现有代码调整）：

```tsx
const [projectVisibleLimits, setProjectVisibleLimits] = useState<Record<string, number>>({});
// 已折叠项目的上限重置为五条；处理持久化折叠状态及用户点击。
// 使用 projectCollapseKey(selectedBackendId, group.cwd) 隔离项目和设备。
const visibleLimit = projectVisibleLimits[projectKey] ?? group.threads.length;
const displayedThreads = query.trim() ? group.threads : group.threads.slice(0, visibleLimit);
const hasCachedMore = displayedThreads.length < group.threads.length;
// “更多”：展示上限加五；缓存不足才 onToggleProject(selectedBackendId, group.cwd)。
// 搜索维持现有展示与分页行为，不写正常项目展示上限。
```

- [x] 补充缓存不足的分页回调、搜索临时展开、无项目分组、关注区和其他项目不受影响的验证；测试用户可见结果，不绑定内部状态实现。
- [x] 运行 `npm test -- tests/ui/thread-list-page.test.tsx tests/ui/project-collapse.test.ts tests/ui/thread-list-model.test.ts tests/ui/thread-list-loader.test.ts` 和 `npm run typecheck`，预期全部通过。
- [x] 独立规格审查通过后执行代码质量审查，修复实际问题并复验。

### Task 2: 协调发布与交付

- [x] 对登记任务 `project-collapse-five-20261014` 持续 heartbeat。
- [x] 执行 `adapter-regression`（Python 发布回归）、`coordinator-recovery`（上游协调器恢复检查）、`build-contract`（`tests/ci` Vitest）、`typecheck`，记录真实命令、返回码及日志路径。
- [ ] 根据 `docs/commit-conventions.md` 提交中文 Conventional Commit，正文含“新增功能”和“主要修改”，推送 `codex/project-collapse-five-20261014` 的固定 SHA。
- [ ] 使用已有 releasectl ready 提交固定 SHA 和真实验证文件；等待对应批次成功 receipt，不独立发包。
- [ ] 核对 receipt 包含任务 SHA 和 APK、已签名 IPA、HTTPS OTA、unsigned 软件源版本；核对固定 JSON、HEAD 和完整 GET 的版本、大小、SHA-256。
- [ ] 交付回复提供 OTA 安装页、APK/IPA 固定下载链接、统一版本、大小、散列和 IPA 签名状态。
