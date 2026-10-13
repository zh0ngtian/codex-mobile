# 会话关注实施计划

> **执行要求：** 使用 superpowers:subagent-driven-development 按任务执行，TDD 先红后绿；中文提交、独立工作区，正式整合与发布使用现有协调器。

**目标：** 用关注替代置顶，只将关注会话放到顶部并从项目移除，关注完成通知不限发起端且支持 App 退出。

**架构：** 本地 pinned ID 集合继续作为关注来源，避免破坏既有状态。订阅扩展 followedThreadIds；移动发起通知继续保留，电脑发起完成仅发送到关注该会话的订阅。独立只读观察关注回合，以启动基线阻止旧完成补发，复用 Bark 投递去重。

**技术栈：** React / TypeScript / Node HTTP 与 WebSocket / Vitest / 现有 releasectl 发布协调。

## 1. 列表和菜单

文件：src/features/threads/thread-list-model.ts、ThreadListPage.tsx、src/features/conversation/ConversationControls.tsx、src/App.tsx、src/i18n.tsx；测试 tests/ui/thread-list-model.test.ts、thread-list-page.test.tsx、conversation-controls.test.tsx。

- [x] 先更新旧被动置顶与双区域测试，断言 `splitAllThreads(items).pinned.every(item => item.pinned)`；关注行在全局 DOM 只出现一次，项目保留普通运行/未读行，取消关注立即归位。
- [x] 执行 `npm test -- tests/ui/thread-list-model.test.ts tests/ui/thread-list-page.test.tsx tests/ui/conversation-controls.test.tsx`，确认现有被动置顶/重复显示/旧文案导致失败。
- [x] `isThreadPrioritized` 仅返回 `thread.pinned`，projectGroups 使用 `visibleThreads.filter(thread => !thread.pinned)`；所有用户可见置顶文案改关注并添加英文 Follow / Unfollow。保留内部字段/存储键兼容及加载活跃摘要。
- [x] 同命令绿灯，现有本地置顶存储测试继续通过。

新增用户要求：项目折叠时名称后显示运行/未读标记，展开隐藏；关注会话不计入项目标记。tests/ui/thread-list-page.test.tsx 与真实浏览器回归覆盖。

## 2. 完成资格与订阅

文件：server/final-answer-completion.ts、server/bark-notifications.ts、server/notification-settings.ts、src/notifications/preferences.ts、src/features/threads/thread-pinning.ts、src/App.tsx；测试 tests/server/final-answer-completion.test.ts、bark-notifications.test.ts、tests/ui/push-settings.test.tsx。

- [x] 失败测试覆盖关注允许电脑发起完成、同回合移动资格迟到去重、每部手机只收到自己关注的电脑会话、取消关注停止后续电脑通知、旧订阅空关注、无效列表拒绝。
- [x] 运行上述三文件确认红灯。
- [x] 完成 tracker 增加按 thread ID 判断可绕过移动来源门槛的回调；Bark 使用关注全集回调，但投递时按具体订阅再次过滤。维护移动授权查询以保留既有行为，不通过放宽全局门槛给全部手机误发。
- [x] 本地关注写入成功后派发专用事件；useNotificationSync 监听事件即时同步；请求按 target.id 从本地 pinned 集合读取 followedThreadIds。归档移除关注也触发同步。
- [x] 客户端移动 tracker 使用本地关注回调，继续保持 catchup/子会话/当前可见/排队规则；运行相关回归至绿灯。

## 3. 独立关注观察

文件：新 server/followed-thread-notifications.ts，网关接入 server/gateway.ts，Bark 关注读取/完成入口；新测试 tests/server/followed-thread-notifications.test.ts。

- [x] 先测试启动不补发历史、启动时运行的回合完成可通知、电脑后续回合、多个完成、失败/打断无通知、取消关注、断线与重启重新建立基线、停止清理。
- [x] 观察器独立于手机连接，仅对被关注会话做只读同步。采用现有 HttpSessions hosted RPC 的 thread/read 与 thread/turns/list；不提交 turn/start/steer、不改变会话权限；读取当前状态与 final 分类。
- [x] 首次读取建立已完成基线，后续新增成功回合或此前运行回合完成交给 Bark 专用关注投递入口；共享按手机地址/会话/回合去重。轮询不重叠，失败重试，结束时清理定时器；关注为空不创建观察请求。
- [x] 单元与真实 HTTP/流式替身回归绿灯，分别独立规格和质量审查。

## 4. 验证与协调发布

- [x] 更新 README 关注、列表和通知现役说明；运行定向 UI、通知、传输回归与 `npm run typecheck`、发布契约和 Python 发布/恢复回归。
- [ ] `git diff --check`、暂存检查，中文 Conventional Commit 提交本次功能及准确正文；推送 codex/thread-following，固定 40 位 SHA。
- [ ] 保存真实命令/日志/通过状态的 validation.json，包含 adapter-regression、coordinator-recovery、build-contract、typecheck；两目标 ready 同一已推送 SHA。
- [ ] 每次 wait 最多 45 秒，持续核对两目标状态和成功 receipt；失败保留批次现场，以关联修复任务推进。
- [ ] 共同客户端成功凭证核对固定 APK、签名 IPA、HTTPS OTA、GitHub 双端、软件源 unsigned 版本及散列；网关成功凭证核对运行部署与 SHA。提供固定 OTA/APK/IPA 链接、双端版本/大小/SHA-256，标注 IPA 签名。归档工作区与测试会话。

## 进度证据

基线：7 文件 137 项通过。用户已确认设计与旧置顶迁移、保留未关注的手机发起通知。

实施验收：17 文件 321 项相关单元/网关回归通过；Chromium、WebKit 14 项浏览器回归及小屏大字号/减少动画、横屏 2 项通过；78 项构建契约、153 项 Python 发布适配器、19 项协调恢复检查通过。类型检查与服务端构建通过。客户端和服务端独立规格审查、独立质量审查均通过；搜索历史关注、503 推送重试、空 final 重复扫描与迟到 final 漏推均先失败后修复。验证全部使用 fixture，无真实测试会话；未进行真机覆盖安装及数据保留验证。
