# 稀疏子 Agent 完成事件免 Bark 通知实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 逐项执行；本任务为连续通知链路，当前 Agent 完成。

**Goal:** 指定实例及同类子 Agent 在网关未收到来源摘要时也不发送 Bark 完成通知。

**Architecture:** 保持现有共享通知分类与客户端行为。仅在 Bark 实际发送前补读本机 rollout 首行 session_meta，按已有 isVisibleThread 判断；只保留来源、父线程和临时标记，不读取历史正文。缺文件或无有效分类时维持普通会话通知。

**Tech Stack:** TypeScript、Node fs/promises、Vitest。

### 任务 1：复现与修复

- [x] 运行现有 Bark 与完成判定测试建立基线。
- [x] 在 tests/server/bark-notifications.test.ts 写本地 rollout 元数据、随后仅发送 final/completed 的回归；分别覆盖 HTTP 与流式、父线程来源、普通主会话。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/server/bark-notifications.test.ts`，确认子会话发生错误通知。
- [x] 新增 server/local-thread-metadata.ts：验证 UUID；依 UUIDv7 毫秒日期查 UTC/本地当日及相邻日期和 archived_sessions；只读取首行，限制 64 KiB，校验 type/id，只返回分类字段。
- [x] server/bark-notifications.ts 队列发送前调用读取函数，并用 isVisibleThread 过滤；异步读取后检查 closed，防止关闭后发送。
- [x] 重跑通知、网关、HTTP 会话测试及 `npm run build:package`、`git diff --check`。

### 任务 2：交付

- [x] README 说明 Bark 本地分类补查；遵守 docs/commit-conventions.md 提交并推送 main。
- [x] 从已推送源码更新长期网关安装，重启 launchd，检查 health 与真实目标元数据分类；通过拦截 fetch 的本地探针验证目标零推送，不发送真实通知。
- [ ] 删除临时产物，归档本任务 worktree，报告验证与提交结果。服务端独立改动无需 APK/IPA 发布。

验证记录：基线 57 项通过；HTTP 与流式新增回归均在旧实现下收到 2 条通知（预期 1 条普通会话通知），修复后五个文件 130 项通过；生产打包成功。真实实例首行 23258 字节，部署前探针识别 threadSource=subagent、父线程存在且不可见。

交付记录：修复提交 `3705ad1` 已推送 main；本机网关保留已安装版本 0.2.136，只更新 `bark-notifications.js` 和新增 `local-thread-metadata.js`（其余服务端模块与构建逐字一致），launchd 已重启。`/api/host` 返回 appServerReady=true。已部署模块读取真实实例，隔离状态目录并拦截 fetch 的探针证明目标零请求、普通会话一次请求，没有真实 Bark 网络推送。部署散列、健康和探针记录保存在主工作区 `.mobile-build/sparse-subagent-notifications/`。客户端代码未变，无需 APK/IPA 更新。未创建测试会话；宿主工作树将在记录推送后归档。
