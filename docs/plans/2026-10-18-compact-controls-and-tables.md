# 紧凑控件、表格和确认弹窗调整计划

目标：按用户11项要求调整现有AgentApp原生呈现，保持真实业务命令和权限语义，验证后交由协调器发布，保留iPhone 17 Pro模拟器验收。

设计已由用户清单及补发参考图确定。参考图在对话中显示为942×2048像素，是完整竖屏截图；设备倍率未知，按相对宽度推断内容边距约为屏宽4%（402pt模拟器约16pt）。表格为白底、黑字、浅灰细横线，无竖线及外框，表头加粗。字号采用系统subheadline（比body基准小2pt），遵循系统字号与粗体设置。按用户第6条覆盖参考图的自动折行：单元格按内容自然宽度横向排布，超宽整表横向滚动，不省略正文。尺寸推断值以模拟器截图核对。

## 实施与验证

- [x] 先补失败界面用例：队列三按钮同排、用户长消息完整显示、表格自然列宽与单行高度、图片工具栏位置、归档为系统alert、页头按钮对齐与紧凑。旧折叠用例按新要求改名。
- [x] 队列：`AgentUI/Flows/QueuedMessageCard.swift`把取消、编辑、改为引导放入一个`HStack(spacing:12)`，保留各自disabled和uncertain取消确认，失败重试仍独立。
- [x] 页头：`Chat/ConversationHeader.swift`使用单个trailing ToolbarItem承载`HStack(spacing:0)`，三按钮各44pt触区；leading抽屉与右侧图标均20pt画布、regular字重、同高44pt；仍是原生导航栏。
- [x] 输入栏：`ComposerBar.swift`和`RunSpeedButton.swift`将加号/盾牌/闪电从body改为subheadline，横向按钮宽度40pt、纵向44pt；模型组间距从10调至8pt。发送按钮尺寸及逻辑保持。
- [x] 图片预览：`Previews/OutputPreviewSheet.swift`图片下载移至leading，关闭移至trailing，其他文件保留原位置，预览、缩放和导出业务不变。
- [x] 消息：`Chat/UserMessageView.swift`去掉展开状态、行数上限和折叠按钮，移除只为折叠宽度服务的隐藏测量，保留时间切换、选择、复制及编辑。
- [x] 表格：`NativeMarkdownTableView.swift`去掉260pt固定列宽，使用内容自然列宽与整行Divider；`NativeInlineContentView.swift`允许传入subheadline和表头strong，仍使用现有可选择文本与链接、图片语义，保留HTML作用域。
- [x] 侧栏：`Home/ChatListRow.swift`将未读点移入标题右侧共用状态槽，运行/异常优先，空闲未读才显示点；左侧不再预留未读点位置，关注文字与文件夹保持对齐。
- [x] 用量：`NativeUsageIcon.swift`移除独立白色圆底，保留黑色circle；核对各强调色下的实际像素。
- [x] 归档：Root把现有`confirmation:`业务panel渲染为系统小alert，不新增归档请求路径。确认/取消沿原始带key命令发送，旧确认不能批准新确认，避免sheet和alert同时呈现；由局部ConfirmationDismissalObserver观察原alert退出和业务panel清除后才唤醒排队sheet，有界核对并随Root取消，不扫描全局窗口或主动dismiss。保留有队列归档的说明。
- [x] 补充DEBUG夹具与自动化，先看到行为失败再实现；验证焦点、手势与横向表格可共存，真实网关归档取消/确认后清理测试会话。
- [x] 同步交互约定与中文发布说明；执行adapter-regression、coordinator-recovery、build-contract、typecheck及对应UI回归，审查后提交推送固定SHA。
- [ ] `conversation-controls-release-20261018` ready，等待成功receipt，核对GitHub、LAN双端、签名/OTA和unsigned软件源；模拟器安装同版并正常启动。

工作区复用现有独立worktree，基于已发布0.3.5及main交付记录。发布目标`codex-mobile-lan-production`，保持heartbeat；不安装真机。

本地验证：7个旧行为用例先失败；修复后16个不同UI用例通过，包括真实网关归档取消/确认并清理测试会话、附件及Markdown内联图片两条预览路径、自然列宽单行表格横向滚动、未读状态槽、十种强调色、历史滚动与侧栏。审查发现确认期间新审批抢占，已先精确复现，再用关闭锁和局部观察修复；串行呈现回归通过，最终审查无Critical/Important问题。219项JS/Swift契约与业务回归、167项Python发布回归、42项协调器恢复回归和typecheck均通过。测试中的AX标签及Button/Menu边界差异已按真实标签和实际截图修正，未用修改生产样式来迁就错误断言。
