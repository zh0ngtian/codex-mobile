# 原生会话业务桥接线地图

本文记录 Task2a 的实际业务接线。SwiftUI 仍复用既有单个 WKWebView 中的 React、客户端与数据状态；没有新增 HTTP、WebSocket 或 RPC 协议栈。默认网页模式不会订阅原生命令，也不会计算原生会话投影。

## 协议与隔离

- `src/native-ui/protocol.ts` 定义完整 v1 展示快照。`NativeWorkspaceController` 是仅存在于 JS 内的业务对象，不能直接序列化。设备仅投影 id、名称和连接状态；后端配置、访问口令与客户端实例不进入常规快照。图片只传递专用资源 URL，并继续使用既有鉴权 URL 语义。
- 业务桥只有在 `__CODEX_NATIVE_UI__ === true` 且 `webkit.messageHandlers.nativeUI.postMessage` 存在时启用。旧 nativeConversation/nativeSidebar 标志、偏好与旧事件均不生效。
- Swift 发 `codex-mobile-native-command`，参数为 `{id,name,params}`；业务通过 `codexMobilePublishNativeSnapshot` 回传快照。所有回调显式映射，未通过 DOM 查询或点击触发业务。
- 每个 JS scene 的 `NativeRuntime` 合并 ConfiguredApp 导航与当前选中 BackendWorkspace。其他 workspace 的流式更新不能覆盖当前画面。发布以 32 ms 合并；请求独立执行，慢发送不会阻塞停止和继续输入。
- `runtime.ts` 是命令白名单与类型验证入口。最多保留 256 个去重请求、64 条完成回执；最多同时执行 64 个请求。回执为 `commandResults: [{id,name,ok,contextId?,error?,fieldKey?,fieldRevision?}]`。异步旧会话错误仍保留回执，但不会覆盖新会话的错误展示。

## 会话上下文与输入

`contextId = backendId + ':context:' + draftContextGeneration`。真实导航或新建会话使 generation 递增；新对话的 `thread/start` 获得实际 threadId 时不改变 contextId，避免清除期间继续输入的文字。发送在首个 await 前同步消费草稿并占用该上下文；业务 busy 状态同步保存到 ref，避免不同命令 UUID 或快速网络 ACK 在 React 尚未提交时重复创建会话/turn。等待首次 threadId 时的新输入保留，已有会话的新输入仍进入原托管队列。

`draft.set` 使用 `{contextId,value,revision,caretOffset?}`。revision 为每个上下文的单调正整数，caretOffset 使用 UTF16 偏移，与现有 JS mention 函数相同。Swift 只接受追上本地版本的 draft/caret；JS 在调用 callback 前占用版本，旧异步完成不能倒退版本。React hook 将接受的 revision 与草稿同批回显，延迟旧 render 不会抢先确认新输入。程序发送清空、发送失败恢复、Skill/Plugin 插入、当前位置插入均回到既有 setDraft。

会话快照中的 message blocks/actions、panel、conversationActions、queued actions 在创建时递归绑定 contextId；旧面板按钮不会用点击时的新上下文执行。

常规字段与搜索命令可附 `fieldKey`、`fieldRevision`；dispatcher 在关联回执中原样回显，原生保留尚未确认的编辑。关闭 panel 仍清理该作用域的数据。

## 导航

ConfiguredApp 使用真实 `scopedThreads`、`projectDirectories`、`collapsedProjectKeys`、各设备 thread snapshot 与原有加载函数投影列表。

| 命令 | 既有业务入口 |
| --- | --- |
| `navigation.sidebar {open}` | `openSidebar` / `closeSidebar`，与 conversationVisible、未读判断保持同步 |
| `navigation.search {value}` | `setQuery`，继续使用现有服务器搜索与元数据搜索合并 |
| `navigation.refresh` | `refreshAllBackends` |
| `backend.select {id}` | `selectListBackend`，仅筛选列表 |
| `navigation.filter {value}` | favorites / projects / sessions 原生视图筛选 |
| `thread.open {backendId,threadId}` | 从当前真实列表定位记录后调用 `openThread`，内部才 `selectBackend` |
| `thread.new` | 现有 `startNewChat`，沿用全部/单机与上次新建设备选择语义 |
| `thread.manage {backendId,threadId,action,value?}` | 现有 `manageThread`；rename 使用显式 value，网页仍保留原来的 prompt |
| `project.toggle / project.more / project.retry {backendId,cwd}` | 原有折叠、加载更多和重试函数；只接受当前快照实际提供的 group action |

全部设备项目视图仍投影各设备的空项目、无项目、折叠状态、加载状态与分页。`group.command` 是折叠动作，`group.actions` 是更多/重试；`navigationItem.actions` 是会话操作。选中态由合并时的真实 backendId/threadId 计算。

## 会话、附件与目录

`workspace-adapter.ts` 的 `NativeWorkspaceController` 明确接收 BackendWorkspace 的 state 与 callbacks。`createWorkspaceAdapter` 只挑选纯展示字段，`useNativeConversationAdapter` 负责 panel/mention 本地展示状态。导航和 workspace 的 callback ref 与对应快照/context 在同一 layout effect 内注册；render 阶段不会提前切换 callback，避免迟到旧命令通过旧 context 校验后执行新会话回调。订阅与卸载同样在 layout 阶段完成，并保留 StrictMode 重挂行为。

| 命令 | 既有业务入口 |
| --- | --- |
| `message.send` | 从网页 FormEvent wrapper 提取的 `sendMessage`，继续调用 startTurnMessage / requestAfterUnsentReconnect 与原 HTTP request UUID 层；busy 时继续使用 HostedQueueSubmission |
| `turn.stop` | `interrupt` |
| `draft.save` | `saveNewChatDraft`，仅对新对话展示；失败有错误回执 |
| `model.select / effort.select {value}` | 目录校验后调用 `chooseModel` / `chooseEffort`，沿用既有设置更新和错误处理 |
| `attachment.pick {kind}` | `codexMobilePickAttachments('photos'|'files')` 返回真实 File[]，再走原 `selectImages` 校验、准备、上传流程 |
| `attachment.remove {id}` | 原 draftImages/draftFiles 删除逻辑与 object URL 清理 |
| `location.insert` | `selectCurrentLocation` |
| `mention.search {value}` | 原生目录面板筛选；Skill/Plugin 目录来自原有 listInstalledSkills / listInstalledPlugins |
| `mention.insert {id}` | `skill:PATH` / `plugin:ID` 定位真实目录，复用 insertSkillMention / insertPluginMention，保留光标后正文并返回新光标 |
| `thread.retry / thread.older` | `retryThreadDetail` / `loadOlderTurns` |
| `message.copy {id}` | 完整正文复制；原生可使用已投影正文的系统剪贴板；JS 回退失败明确报错 |
| `message.edit {turnId,messageId}` | `createHistoricalMessageEditTarget` / `beginHistoricalMessageEdit`；完整历史编辑面板属于 Task2b |
| `queue.send / queue.cancel / queue.edit` | 现有排队消息管理回调 |

附件 promise 与旧 input 回调按请求路由隔离，旧网页 input 行为保留。取消返回空数组，读取失败 reject，卸载会结束尚未完成的 promise；选择期间切换上下文不会把结果写入新会话。输入菜单保留图片、文件、当前位置，没有增加语音或相机。

会话投影复用 `groupConversationTurns` 与 `splitTurnResponseSegments`，保留用户插话顺序、最终正文与运行中的 commentary。final 到达即显示；有 final 后只折叠 commentary，计数不含 reasoning/tool/diff/media。整轮媒体按来源去重，生成结果优先于同源截图，多张过程截图独立折叠。普通用户图片保留在 user.blocks。本地图片的 value 使用现有缩略图资源 URL，previewURL 使用移除 thumbnail 参数的原图 URL；二者保留现有 token/path 鉴权语义。远程 HTTP 图片与 data URL 保持原值。

## 生命周期

`foreground.ts` 提供纯 `isClientForeground` 判定：原生使用可信宿主设置的 `__CODEX_NATIVE_ACTIVE__`，网页继续使用 document.visibilityState。App 队列与未读判断、HTTP transport、connection-recovery、通知同步、更新检查和 realtime 可见性检查均复用该 helper。scene 的 JS 活动更新仍通过现有 visibilitychange / focus 恢复机制处理；没有创建第二条连接。

## 后续模块的明确接口

Task2b 在 `NativeWorkspaceController.extended` 已取得以下 JS 内部能力，不能把整个 extended 对象发布给 Swift：

- state：historyEdit、requests、approval、userAnswers、permissionModes、selectedPermissionModeId、serviceTier/speedOptions、pendingAction、tokenUsage、rateLimits、projectOptions、backends、draftSaveStatus、会话访问与恢复状态。
- callbacks：chooseSpeed、choosePermissionMode、replyToRequest、change/cancel/submitHistoricalMessageEdit、chooseNewChatProject、switchNewChatBackend、togglePinned、duplicateActiveThread、renameThread、archiveThread、reopen/answer/dismissApproval。
- 全局设备与设置控制仍在 ConfiguredApp：registry/persistRegistry、transportMode/onTransportModeChange、notificationPreference/onNotificationPreferenceSave、appUpdate、draftsOpen/草稿恢复逻辑。扩展原生 panel 时复用这些拥有者，显式扩展 runtime 白名单与参数验证。

Task2a 仅为 tool/changes 提供真实代码/差异内容的通用 panel；完整设备 CRUD、扫码、草稿列表恢复、通知与更新、语言字号、模型服务档位与权限、审批、历史编辑与工具/文件丰富预览由 Task2b 完成。冷启动检查点、双向界面切换与发布验收属于 Task3 / 协调入口。

## 验证记录

新增行为遵循 RED→GREEN；日志位于 `.mobile-build/native-reference/task2a-*.log`，覆盖 dispatcher/context/revision、React adapter/StrictMode、真实 App 导航与发送/停止/UUID 托管队列/失败恢复、turn 与媒体投影、UTF16 mention 光标、附件 promise、前后台与默认网页隔离。最终全量测试与 Swift 构建由本轮整合后再次核对。
