# 原生会话业务桥接线地图

本文记录 Task2a 与 Task2b 的实际业务接线。SwiftUI 仍复用既有单个 WKWebView 中的 React、客户端与数据状态；没有新增 HTTP、WebSocket 或 RPC 协议栈。默认网页模式不会订阅原生命令，也不会计算原生会话投影。

## 协议与隔离

- `src/native-ui/protocol.ts` 定义完整 v1 展示快照。`NativeWorkspaceController` 是仅存在于 JS 内的业务对象，不能直接序列化。设备仅投影 id、名称和连接状态；后端配置、访问口令与客户端实例不进入常规快照。图片只传递专用资源 URL，并继续使用既有鉴权 URL 语义。
- 业务桥只有在 `__CODEX_NATIVE_UI__ === true` 且 `webkit.messageHandlers.nativeUI.postMessage` 存在时启用。旧 nativeConversation/nativeSidebar 标志、偏好与旧事件均不生效。
- Swift 发 `codex-mobile-native-command`，参数为 `{id,name,params}`；业务通过 `codexMobilePublishNativeSnapshot` 回传快照。所有回调显式映射，未通过 DOM 查询或点击触发业务。
- 每个 JS scene 的 `NativeRuntime` 合并 ConfiguredApp 导航与当前选中 BackendWorkspace。其他 workspace 的流式更新不能覆盖当前画面。发布以 32 ms 合并；请求独立执行，慢发送不会阻塞停止和继续输入。
- `runtime.ts` 是命令白名单与类型验证入口。最多保留 256 个去重请求、64 条完成回执；最多同时执行 64 个请求。回执为 `commandResults: [{id,name,ok,contextId?,error?,fieldKey?,fieldRevision?}]`。异步旧会话错误仍保留回执，但不会覆盖新会话的错误展示。

## 内置首页地址与真机路径

`NativeUIBridge` 与业务 WebView 都从 `Bundle.main.url(forResource: "index", withExtension: "html")` 取得同一个原始资源 URL。注入、命令、偏好回执、扫码、恢复与前后台脚本中的可信地址保留原始 `absoluteString`；JavaScript 继续严格检查顶层 `file:` 首页。Swift 收取消息时仍对 URL 标准化并比较精确首页，拒绝 query、fragment 和其他文档。

不要把 `standardizedFileURL` 的结果写进 JavaScript 的 `location.href` 字符串守卫。真机 WebKit 可保留 `/private/var/...`，Foundation 对真实存在路径的标准化会产生 `/var/...`；二者指向同一资源，却会导致守卫拒绝注入。模拟器 `/Users/...` 首页不会暴露此问题。跨 Swift 回归使用真实存在的 `/private/tmp` 文件验证该差异，详见[根因与回归证据](superpowers/plans/evidence/2026-10-15-native-switch-missing-root-cause.json)。

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
| `message.edit {turnId,messageId}` | `createHistoricalMessageEditTarget` / `beginHistoricalMessageEdit`；编辑器挂到精确匹配的原消息，继续通过 history.* 命令调用原编辑回调 |
| `queue.send / queue.cancel / queue.edit` | 现有排队消息管理回调 |

附件 promise 与旧 input 回调按请求路由隔离，旧网页 input 行为保留。取消返回空数组，读取失败 reject，卸载会结束尚未完成的 promise；选择期间切换上下文不会把结果写入新会话。输入菜单保留图片、文件、当前位置，没有增加语音或相机。草稿附件的可选 type 使用既有 MIME；只有音视频文件携带绑定创建上下文的 attachment.preview 命令。点击后复用 readFileAsDataUrl 读取当前单个 File，在 audio/video 面板投影 data URI；普通文件保留名称图标，图片继续使用原 data URI。不会逐帧读取全部文件或向 Swift 传 blob URL；100 MB 上限、读取错误重试及关闭/移除/换会话时的 epoch 与 File 身份检查保留。

会话投影复用 `groupConversationTurns` 与 `splitTurnResponseSegments`，保留用户插话顺序、最终正文与运行中的 commentary。final 到达即显示；有 final 后只折叠 commentary，计数不含 reasoning/tool/diff/media。整轮媒体按来源去重，生成结果优先于同源截图，多张过程截图独立折叠。普通用户图片保留在 user.blocks。本地图片的 value 使用现有缩略图资源 URL，previewURL 使用移除 thumbnail 参数的原图 URL；二者保留现有 token/path 鉴权语义。远程 HTTP 图片与 data URL 保持原值。

## 生命周期

`foreground.ts` 提供纯 `isClientForeground` 判定：原生使用可信宿主设置的 `__CODEX_NATIVE_ACTIVE__`，网页继续使用 document.visibilityState。App 队列与未读判断、HTTP transport、connection-recovery、通知同步、更新检查和 realtime 可见性检查均复用该 helper。scene 的 JS 活动更新仍通过现有 visibilitychange / focus 恢复机制处理；没有创建第二条连接。

## 扩展业务面板接口

`NativeWorkspaceController.extended` 提供以下 JS 内部能力；投影只挑选明确展示字段，不能把整个 extended 对象发布给 Swift：

- state：historyEdit、requests、approval、userAnswers、permissionModes、selectedPermissionModeId、serviceTier/speedOptions、pendingAction、tokenUsage、rateLimits、projectOptions、backends、draftSaveStatus、会话访问与恢复状态。
- callbacks：chooseSpeed、choosePermissionMode、replyToRequest、change/cancel/submitHistoricalMessageEdit、chooseNewChatProject、switchNewChatBackend、togglePinned、duplicateActiveThread、renameThread、archiveThread、reopen/answer/dismissApproval。
- 全局设备与设置控制仍在 ConfiguredApp：registry/persistRegistry、transportMode/onTransportModeChange、notificationPreference/onNotificationPreferenceSave、appUpdate、draftsOpen/草稿恢复逻辑。扩展原生 panel 时复用这些拥有者，显式扩展 runtime 白名单与参数验证。

### Task2b 已接线模块

| 模块 | 面板与实际业务入口 |
| --- | --- |
| 会话设置 | `workspace` 及 model/effort/speed/permission 别名；真实目录校验后调用 chooseModel/chooseEffort/chooseSpeed/choosePermissionMode，显示连接、访问、同步、线程目录、上下文与额度、待处理状态 |
| 新对话目标 | `newchat.backend/project` 复用原目标设备、项目回调，切设备和保存草稿同步消费 currentDraftRef，保留尚未 render 的输入且不自动发送 |
| 会话操作 | 原 pin/duplicate/rename/archive 回调；重命名显式传值；归档中涉及排队消息时通过原生确认等待答案，网页继续使用原 confirm |
| 审批 | `approval.answer/decide/submit/dismiss/reopen` 复用 approval-model 与 useApprovalRequests；决定仅映射当前 availableDecisions 的有效下标，回答读取同一拥有者已接受的最新答案 |
| 历史编辑 | 原生输入框位于原消息位置，`history.change/cancel/submit` 复用原编辑回调与附件 input；真实存在后续对话时显示显式删除确认；historyEditRef 同步占用提交状态，防止连续不同 UUID 重复回退与发送 |
| 排队消息 | `queue.change/edit/cancel/send` 保留原 hosted queue UUID、revision、HTTP pending 与查询语义，严格按 sending/uncertain、busy/steerable、failed 与同步状态提供编辑、取消、引导和重试 |
| 设备与设置 | `settings.open {id}` 打开 devices/language/font/transport/notifications/updates；BackendManagerSheet 自身状态直接投影，probe/hostId 校验、注册表启停重排删除复用旧入口，繁忙或队列操作使用显式确认 |
| 扫码 | 宿主 `codexMobileScanGatewayQr()` 返回原始扫码内容，再走 applyScannedGateway；只填现有表单，仍需测试并保存；取消或设备表单变化不会写入另一表单 |
| 推送与字号 | Web 与原生共享 usePushSettingsState/useFontSizeSettings 的单一状态；Bark 校验、保存错误及未同步设备均保留，字号与语言立即反映在 snapshot |
| 无设备启动 | UnconfiguredApp 与 ConfiguredApp 互斥挂载各自 runtime；无设备立即 ready 并展示添加设备表单，关闭后仍有重新添加入口 |
| 本地草稿 | DraftsSheet 直接投影已有 list/remove/retry/restore；只传元数据，恢复回调获得原 IDB 二进制记录，不复制记录、不发送消息 |
| 应用更新 | AppUpdateSheet 原 phase、进度、更新说明、install/retry/close；`manualCheckSupported=false` 不投影手动检查动作 |

全局面板通过 runtime 的独立注册通道合并，按真实打开顺序展示；后台组件重新 render 不抢面板。`panel.close` 按当前 DTO id 路由到拥有者。全局设置别名不会接管 mentions、工具或会话面板。关闭或切换会话后，旧请求完成不能关闭新面板。审批、历史确认或队列确认对应记录消失后，瞬态面板直接撤下，不投影空的内容过期面板；后续审批仍显示当前请求。

审批 DTO id 为 `approval:<approvalKey>`；原位历史编辑仍使用 `history-edit:<editKey>` 身份，但随目标消息投影，不进入通用 sheet；只有删除后续确认为 `confirm-history:<editKey>` 弹层。两个审批分支均显示请求实际 threadId，标题复用 completionThreadTitle，设备级队列中的其他会话不会被误认为当前会话。字段缓存随身份隔离，旧面板无法回答新请求；提交中禁用字段和关闭。问题选项仅使用静态 option 下标及 other 哨兵，自定义 secret 仅进入 secureField 和原审批内存状态，不放入 Picker 选项或额外持久存储。

### 富内容展示契约

- 工具详情挑选命令、cwd、状态、耗时、退出码、参数及输出，不把整个工具对象 JSON 充当业务面板。文件变更复用 summarizeFileChange，展示逐文件统计、真实 diff 及打开文件动作；相对路径仅在真实 active.cwd 可正规化为受支持路径时提供打开动作，缺少目录时保留差异但不生成无效按钮；运行计划、折叠推理、上下文压缩与失败图像诊断保留。
- `file.open {href}` 复用 parseRemoteFileHref 和原客户端 `fs/readFile`，复用既有 base64 文本/二进制判定。Markdown/HTML 可切预览与源码，图片、SVG、音视频和下载使用既有鉴权资源 URL；不会创建跨 WK 无效的 blob URL。
- 普通远程源码使用 `kind=source, title=文件名, text=完整源码, line=可选目标行`，供原生显示行号、目标行高亮与定位。SVG 文件读取真实文本后使用 html 展示。
- 用户与助手正文资源均复用 nativeItemText 去除业务标题指令后收集；用户 Markdown 的本地图片、Mermaid 和文件链接保留。正式 videoGeneration 与 imageGeneration 一起参与媒体去重；运行中产物已就绪即可播放，无产物运行态与失败态保留明确入口及原工具错误详情，不创建不存在的视频诊断接口。
- `NativeSnapshot.richContent` 仅提供当前实际内容所需的资源：本地 Markdown 图片 `kind=image, text=原始href, value=缩略URL, previewURL=原图URL`；Mermaid `kind=html, text=规范化LF后的原始源码, value=既有strict引擎生成的SVG`。绘图仅在专用离屏容器布局，没有 DOM 查询或点击业务动作。
- html/SVG 的 Swift 隔离 WK 无业务桥与持久 store；audio/video/file 使用专门原生展示和下载。没有整屏旧网页业务兜底。

### 双向切换与启动检查点

- iOS 首次默认网页界面配合原生输入框，完整原生界面仍默认关闭；Swift 在进程首次读取偏好后冻结本次模式。两边设置共用 `settings.native-ui` / `NativeSwitchBoundary`，只有专用 IndexedDB 检查点完整事务成功后，才请求宿主保存下次启动偏好；宿主写入失败恢复原值。
- `codexMobileNativePreference({enabled?, kind?: "interface" | "composer"})` 通过可信首页桥读取或保存偏好，回传 `{enabled, active}`；当前运行模式不随偏好变化。未就绪或恢复失败时禁用切换；丢失回执有按请求 ID 匹配的有界错误回收。
- 检查点使用独立数据库，不进入手动草稿列表。保存全部已挂载工作区正文、图片、文件完整二进制、设备、项目、线程与发送配置。设置使用明确白名单；不复制 HTTP session/pending writes、审批秘密答案或待确认写操作。
- 已准备切换后继续编辑，会串行合并最新状态；同一 File 的二进制读取缓存避免每个字符重复读取。存储失败显示错误、保留当前输入。冷启动先恢复目标与内容再挂载业务；已有线程的首轮 resume 保留本地发送选择，同时同步服务器消息、访问状态，之后普通重连仍采用服务器设置。
- 人工“使用旧界面恢复”只揭示当前 WK，设置一次性呈现恢复标记并解除原生确认，不重载文档、不重挂业务工作区、不重连传输、不改变持久偏好。原生专用 runtime 停止发布，旧 Web 的设置、面板和确认恢复原有操作。

正式构建、版本分配、签名与渠道回验继续由发布协调入口负责。用户指定 OTA-only 时使用独立 `codex-mobile-ios-ota-production` 目标，按批次整合到 main，并保留真实来源的历史 OTA 凭证。该目标本轮仅完成实现与登记，用户已取消发布，首次真实批次状态见发布协调说明。

## 验证记录

新增行为遵循 RED→GREEN；日志位于 `.mobile-build/native-reference/task2a-*.log`，覆盖 dispatcher/context/revision、React adapter/StrictMode、真实 App 导航与发送/停止/UUID 托管队列/失败恢复、turn 与媒体投影、UTF16 mention 光标、附件 promise、前后台与默认网页隔离。最终全量测试与 Swift 构建由本轮整合后再次核对。

Task2b 分模块 RED→GREEN 日志位于 `.mobile-build/native-reference/task2b-*.log`。最终关联回归覆盖原生 dispatcher/面板/实际 App 发送与历史编辑、设备/推送/字号、审批、草稿、Mermaid、图片与更新；纯 TypeScript 侧检查不能替代 Swift 整合、模拟器或真机验收。

## 2026-10-16 设计稿对齐

原生对话顶部新增锚定用量面板，继续使用现有 `contextUsageView` 的最近请求占用；七天套餐额度投影来自现有 `rateLimits`，仅有可靠的窗口长度和重置时间时计算时间剩余。缺失数据不使用网页原型的演示值。新增字段保持可选以兼容既有快照。

模型与思考强度共用 SwiftUI `Menu` 系统弹出菜单，按模型、思考强度两个 `Section` 平级列出选项并显示当前选中标记，与会话菜单采用相同系统菜单形式。选项按钮创建时捕获 `contextId`，选择继续走既有 `chooseComposerOption`；过期菜单和不可编辑状态不能派发更改。权限保留独立说明面板，附件面板保持原入口，这两类临时调节面板关闭后仅在原输入上下文仍有效时恢复原焦点。速度菜单继续使用权威 `snapshot.speedValue`，`fast` 显示 `bolt.fill`，其余状态显示 `bolt.slash`，辅助功能值同时说明 Fast 开关；不建立乐观速度状态。输入栏的附件、权限、速度、停止、发送图标及模型/思考文字统一继承基准 16pt 的 `NativeScaledFont`，跟随现有字号比例与 Dynamic Type，44pt 点击范围及 28pt 发送圆底保留。侧栏项目行不再带新建图标，最近对话和底部新建入口继续保留。设置首页展示现有偏好的实时投影，语言与字号直接选择，版本行只展示已安装版本。iOS 不做启动、前台或手动更新检查，不接收升级事件，也不在 App 内触发 OTA 安装；Android 更新流程保持原有行为。

## 网页原生输入框

两个 UserDefaults 偏好独立保存：`codexMobile.useNativeUI` 默认 false，`codexMobile.useNativeComposer` 默认 true。启动时冻结两个值，同进程的新 scene 不提前使用保存值；完整原生模式优先。独立输入开关通过 `settings.native-composer` 复用 `NativeSwitchBoundary` 的检查点事务、增量保存、失败恢复及并发锁，不能直接绕过网页保存草稿。

`isNativeUIEnabled` 保持整页呈现和前后台语义；`isNativeBridgeEnabled` 只扩展 runtime 的创建、监听和发布。每个 scene 继续使用既有单个业务 WebView 和一个 runtime；两个可信启动 flag 分开注入，消息和布局脚本仍校验原始 Bundle 首页、主 frame 和同一 WebView。

真实挂载的 `ConversationPage` 登记 `{contextId, visible, blocked}`。runtime 仅发布当前设备且上下文匹配的呈现，旧上下文清理不能移除新登记。公共遮罩通过 overlay-scroll 的只读订阅通知，页面另登记设置、审批、历史编辑、预览、会话菜单、队列编辑和已有 realtime 状态。遮罩出现收起原生输入并失焦，关闭后不主动弹键盘；网页 form 在混合模式中卸载。只读重连、处理附件、待引导和新对话草稿提示保留在历史末尾，新对话机器与项目选择继续使用网页。

设备设置、草稿、更新和确认保留网页呈现；workspace adapter 继续持有真正 runtime，使用 composer 呈现模式抑制自动审批镜像。由原生输入栏显式打开的面板仍复用原有业务命令。混合宿主保持稳定，原生 sheet presenter 不因 panel 出现而重建。

非交互 `NativeComposerLayoutProbe` 测量整个输入容器（含候选、提示、附件与队列），弱引用桥把顶部转换到同 window 的业务 WebView，按 0.5pt 去重后发出 `codex-mobile-native-composer-layout`。网页按 `top * innerHeight / webViewHeight` 换算遮挡，只为 timeline 增加实测留白；键盘和主页安全区不重复叠加。隐藏清理把顶部放回 WebView 底边，网页遮挡归零；top=0 仍是有效几何。监听随页面上下文清理。

两种原生输入呈现始终使用同一个纵向 `TextField`，取消最大化按钮与强制填满高度。硬换行和自动折行使输入从一行自然增长，超限后由控件内部滚动，删除后缩回。竖屏普通/辅助字号分别最多六/三行，横屏分别最多二/一行；再取实际宿主高度预算允许的更小上限，至少保留一行。宿主高度由 `NativeUIHost` 外层几何传入完整原生页和混合输入，实测扣除候选、提示、附件、队列及外边距后为工具栏预留 80pt，不从已扣输入栏的正文高度反推，也不重复扣键盘或安全区。非有限高度和无效行高使用安全预算，极大有限高度先限制自然上限再转换整数。只有切换会话上下文时重置局部输入状态。`selectionRevision` 只在权威正文或 UTF-16 光标变化时推进，本地绑定和相同草稿 echo 不强制重设 TextSelection，以保留中文组字状态。

关联自动化已验证真实 ConversationPage 呈现、遮罩、布局与恢复、检查点事务、真实 Swift Store/DTO/偏好以及可信 JavaScript 生成与执行。2026-10-16 整合后全量 1458 项测试通过，iOS 27 离线模拟器的 11 个输入、开关、组字、布局与错误场景分别通过，实际范围见[本轮验证记录](superpowers/plans/2026-10-16-native-web-composer.md#2026-10-16-本地验证记录)。未创建真实远端测试会话，未进行真机覆盖安装或数据保留验收；正式渠道交付仍以协调器成功凭证为准。
