# Bark 同一接收地址重复通知修复计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话执行，遵循 TDD；独立 worktree 开发，提交推送并部署网关。

**目标：** 同一 Bark 接收地址对同一会话、同一回合只收到一次完成通知。

**架构：** 保留按安装 ID 与后端 ID 管理订阅和注销的规则；投递按规范化 Bark 地址聚合，选用最后登记的订阅生成打开链接。持久去重改为接收地址、会话 ID、回合 ID，兼容同地址现存订阅的旧去重记录。

**技术栈：** TypeScript、Vitest、HTTP/WebSocket、launchd 网关。

## 根因证据

本机当前两条订阅具有不同安装 ID 和后端 ID，但指向同一 Bark URL。最近两天 rollout 与持久去重散列对账，20 个已通知回合中有 7 个回合分别命中两条订阅的记录。旧实现按 `[clientId, backendId, threadId, turnId]` 计算散列，订阅遍历因此向同一接收地址投递两次。地址与 Key 不进入文档。

## 执行步骤

- [x] 安装依赖并执行现有通知测试基线：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/bark-notifications.test.ts tests/server/final-answer-completion.test.ts`。
- [x] 在 `tests/server/bark-notifications.test.ts` 增加同地址不同安装/后端、不同地址各自投递、重启后订阅 ID 变化、旧去重记录兼容、注销一个同地址订阅后的回归场景。
- [x] 运行新增测试确认同地址场景失败：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/bark-notifications.test.ts -t '接收地址|旧安装'`；预期旧实现发送两次或重放旧回合。
- [x] 修改 `server/bark-notifications.ts`，先按地址归并订阅，再计算 `sha256(JSON.stringify(["bark-destination", barkUrl, threadId, turnId]))`；发送前检查该地址现存订阅的旧散列，保存新记录后沿用现有发送与重试。
- [x] 执行通知与传输测试、类型检查和服务端构建：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/bark-notifications.test.ts tests/server/final-answer-completion.test.ts tests/server/http-session.test.ts tests/server/gateway.test.ts`，`npm run typecheck`，`npm run build:server`。
- [ ] 更新 README 的同地址去重约定；执行 `git diff --check` 与暂存检查，按照中文 Conventional Commits 提交正文要求提交、集成并推送。
- [ ] 从长期主工作区现役网关包读取模块布局和 launchd 启动约定，只部署本次改变的编译模块；取得网关部署锁、备份旧模块、原子替换并重启网关，鉴权健康检查及部署模块散列核对通过后删除临时备份。
- [ ] 记录验收结果并推送文档，归档本次 worktree；仅服务端改动，无需构建移动安装包。本次使用协议模拟，不创建真实测试会话，也不向用户设备发送测试推送。

## 开发验收

- 原有通知基线 66 项通过。
- 新增 5 项回归在旧实现下全部按预期失败：HTTP/流式同地址均收到 2 次，不同地址合并场景收到 3 次，安装 ID 变更和旧记录场景重放通知。
- 修复后新增 5 项通过；通知、回合完成与 HTTP/网关回归共 135 项通过。
- `npm run typecheck`、`npm run build:server` 与 `git diff --check` 通过。
- 部署前本次基线编译模块与现役 Bark 模块 SHA-256 完全相同；部署仅替换该模块，保留其他任务的已部署改动。
