# Android 原生开发验收

## 2026-11-11：Material You 原生呈现

用户确认方案 A：Kotlin / Jetpack Compose / Material 3 负责呈现，唯一隐藏 WebView 执行现有共享业务。本次只交付源码；未发布客户端、未部署生产网关、未调整发布版本。开始基线见[实施记录](plans/2026-11-11-android-native-material.md)。

### 实现范围

- Material You 动态取色、系统/浅色/深色与本机偏好，原生侧栏、搜索、设备筛选、项目与会话操作、新对话、输入和设置。
- 既有 v1 展示 DTO 与命令覆盖模型/强度、速度、权限、附件/位置、队列引导与重试、审批、历史编辑、手动草稿、Sidechat、选文引用和文件面板。业务、存储和发送 UUID 仍由共享层拥有。
- 抽屉拖动与开合、会话进退、底部弹层进退、列表插入/移动、项目与过程展开、输入高度、发送等待和图片缩放。关闭弹层保留内容至退场完成；退出会话的编辑回调不能改变新会话。
- 原生 TextView/Markwon 正文和系统选文，独立代码块与表格单元格；引用块和列表内的代码/表格也保留正确来源区域。文件引用使用编码路径并保护代码/链接/HTML 示例。
- Coil 2 统一加载 data URI、远程图片和 SVG；原生音视频、隔离 HTML/SVG 预览与系统文档保存。取消异步媒体工作时清理临时文件，旧上下文不能向新会话写入错误。

### 实际验证

| 层次 | 结果与范围 |
| --- | --- |
| TypeScript | `npm run typecheck` 通过；11 个文件、105 项关联测试通过，覆盖既有业务协议、输入/回执、界面切换、bootstrap 信任边界、附件取消重开、QR、生命周期及打包 recipe 合同。 |
| 前端/工程准备 | `npm run build` 与完整 `npm run android:prepare` 通过；读取固定容器 SHA，准备脚本先完成 staging 再替换旧输出。补丁连续执行幂等校验通过，`--plan` 不生成工程或包。 |
| Android 构建 | Kotlin 与 AndroidTest 编译通过；按原 recipe 的应用身份和混淆配置执行 `:app:minifyDebugWithR8` 通过。没有执行正式安装包交付。 |
| Android instrumentation | 完整 Android 16 Google APIs 镜像中17项全部通过：输入及发送回执、旧上下文隔离、搜索、重开字段乱序回执、队列布局/动作、data URI 解码、文件链接点击、两列表头和真实长按菜单、嵌套引用/列表代码来源，以及真实内置 WebView→React→Compose 设备表单打开/取消。仅运行 `com.app.pakeplus.nativeui` 包；容器自带旧包名断言不作为本次用例。 |
| 视觉证据 | 已检查正常字号、竖屏下的[浅色会话](assets/android-native/2026-11-11/conversation-light.png)、[侧栏](assets/android-native/2026-11-11/drawer-light.png)、[长队列](assets/android-native/2026-11-11/queue-light.png)和[深色设置](assets/android-native/2026-11-11/settings-dark.png)完整屏幕截图。录制测试过程，逐帧复核抽屉进入和底部弹层呈现；未进行帧率基准测量。 |
| 独立审查 | 已修复 data URI 解码、队列主动作、快照容量、表格选文、文件引用、补充区限高、搜索同步、退出动画输入归属，以及多列表头、嵌套引用区域和重开面板字段版本问题。复审未发现剩余确定的 Important/Critical。 |

测试日志和本机图像位于独立 worktree 的 `.mobile-build/android-*.log`、`.mobile-build/android-evidence/`。这些是开发验证，不是发布凭证。

### 环境与执行边界

JDK 17、Android SDK 36、Gradle 8.11.1、AGP 8.10.1、Kotlin/Compose 插件 2.1.21、Compose BOM 2025.06.01。保留最低 API 24 和原 targetSdk 34。生产应用身份仍为 `vip.loock.codexmobile`。

测试在生成目录使用 `vip.loock.codexmobile.nativeqa`，关闭 QA 混淆以运行 instrumentation；该临时调整不进入正式 recipe。测试夹具只编入 androidTest，生产入口没有模拟消息、连接或业务执行器。

先使用 Android 16 AOSP ATD 精简镜像验证状态、图片解码和 Compose 行为；该镜像全屏截图返回黑屏，因此改用完整 Android 16 Google APIs 镜像、正常字号、竖屏验收。选文菜单初测未定位成功，最终确认原生选区和工具栏正常：自定义动作位于非焦点 platform popup 的“更多”菜单，修正测试访问路径后通过，保留该真实菜单测试。连接的 OnePlus 真机未完成独立 QA 包安装，不记为通过，没有覆盖现役应用。

测试不连接生产网关，不保存测试设备，不创建真实业务会话。测试包和本次独立模拟器在验证完成后清理，因此没有需要归档的后端测试会话。

### 待验收

- 真机首次安装、覆盖升级、既有设备/草稿保留、前后台恢复和系统权限。
- Android 真实网关端到端发送/停止、附件导入、审批、队列失败恢复、历史编辑、文件保存和 Sidechat 往返；共享层回归及夹具命令验证不能替代这些场景。
- 壁纸动态取色的用户偏好、实际手感和长时间流式输出。系统动画缩放由 Compose 原生时钟处理，本轮不宣称完成帧率或性能基准测试。

源码合入和开发验证不代表现役 APK 已包含此界面。后续发布必须由用户明确授权并遵循当时现行发布协调规则。
