# Android 原生开发验收（历史）

2026-11-11 用户在实机查看后要求删除 Android 原生代码并保留 Web 页面。当前源码已移除本页所述 Compose 实现、启动桥及专用测试；下列截图、结论和边界保留为当时记录，不作为现行实现或后续验收入口。当前 Android 规则见[交互约定第8节](interaction-alignment.md#8-功能范围分组与验证入口)，本轮移除尚未正式发布。

0.3.45 已完成正式 GitHub APK 发布，包含此前 Material You 原生界面与紧凑布局改进；标准密度方案 B 及本页首节的实机修复为后续源码优化，尚未发布。0.3.45相同运行源码的开发验收与正式包原生入口、版本、签名证书及完整下载散列已核对，发布批次和边界见[公共凭证](superpowers/plans/evidence/2026-11-11-native-layout-release.json)。下列早期开发记录保留当时状态；独立QA实机巡查见首节，正式包覆盖升级与既有数据保留仍待验收。

## 2026-11-11：OnePlus 实机巡查与两项修复（局部已验证，未发布）

用户授权在已解锁实机安装、连接指定网关并检查裁切和遮挡。开发基线为 main `547d7d79c8d239e49c278dd209ef9d39b8095a0d`，使用原独立工作树；仅修改 Android 原生呈现和对应回归，不改共享业务、网关或 iOS。

- 实机为 OnePlus PME110、Android17、1080×2344；沿用用户当前480dpi显示密度、0.9系统字号系数与竖屏，没有修改系统字号/密度。
- 安装独立调试身份 `vip.loock.codexmobile.material3qa`，桌面名称 `Codex Mobile M3 QA`；版本0.3.0/3000只是QA元数据，不是正式发布版本。原正式应用保留，QA设备配置在调试包重新安装后保留，不据此声称正式应用覆盖升级或数据保留已验证。
- 真实连接用户指定网关，只读查看已有会话；本地键盘草稿已清空，没有创建、发送或归档后端测试会话，没有停止任务、改变原会话配置、复制或置顶会话。

| 步骤 | 实机观察与健康状态 |
| --- | --- |
| 1. 添加设备、连接与新对话 | 已验证：名称和明文地址字段、保存/取消、连接状态、空态、页头和固定输入工具完整可见，真实目录载入成功。 |
| 2. 侧栏、搜索与项目选择 | 已验证：顶部四操作、展开项目/五条会话、搜索与结果、长项目菜单均可查看；长标题按现行约定单行省略，关闭搜索清空条件。 |
| 3. 运行态及完成态阅读 | 已验证：长文本/URL换行、完成回复、执行过程展开、页头与输入工具可见。只读巡查，不据此声称发送、停止或历史编辑端到端通过。 |
| 4. 配置菜单、会话设置 | 已验证：模型、强度、权限、速度、附件菜单以及可滚动的会话设置、用量和长路径无文字裁切或系统栏遮挡。 |
| 5. 应用设置、设备管理与草稿箱 | 已验证：浅深色与系统栏同步，长标签、设备列表/编辑表单、底部入口和草稿空态可达；设置与输入法偏好在检查后恢复。 |
| 6. 键盘、多行草稿 | 已验证（搜狗）：自动换行和超过六行的内部滚动时，模型/强度、工具和发送均在键盘上方。微信输入法在ADB物理输入状态下仅呈现候选窗，未完成其完整软键盘视觉验收；临时切换机上已有搜狗验证后恢复微信及原硬键盘显示设置。 |
| 7. Skill / Plugin 长说明 | 原有P2缺陷已修复并实机复验：胶囊弧线裁切长说明首末行，带说明操作改为标准大圆角，浅深色下完整显示并可滚动；短操作保留标准按钮形状。 |
| 8. 转场快照累积 | 确认P1缺陷：修复前20:13及20:23两次256MiB Java堆耗尽；重新启动后约25MiB增长至约214MiB。堆中559份NativeSnapshot，转场缓存的键数组持有其中558份。改为会话身份作为动画状态，当前页随快照更新，退场页仅保留最后一份。修复后实机堆快照仅5份NativeSnapshot；随后5分钟16次采样的Dalvik Heap Alloc约10–16MiB，进程未重启，未再出现此前持续增长和退出。短时观察不代表长期稳定性全部验证。 |

本机证据目录为任务 worktree `.mobile-build/material3-real-device-20261111/`。截图按步骤编号保存，`32-skills-fixed-dark.png`、`35-skills-fixed-light.png`和最终`50-final-skills-light.png`为修复后的长说明；`29-composer-long-draft-keyboard.png`、`30-composer-multiline-keyboard.png`为键盘证据；`qa-crash.log`、堆摘要和内存观察日志保留故障事实。原始图像与堆含真实会话信息，只保存在忽略目录，不提交仓库。

最终Android编译与AndroidTest编译通过，Android16完整镜像25项原生回归全部通过。新增两项导航回归：80次同会话更新后旧快照可回收（容许至多4份过渡/重组快照），以及新旧会话退场前后内容交接。相同最终测试在修复前失败，80份旧快照全部残留；修复后通过。仪器测试与专用模拟器已清理，实机保留用户授权的QA应用。

Android17实机上的现有Espresso在初始化时因 `InputManager.getInstance` 缺失而失败，两项均未进入测试体；不为此修改生产代码或宣称真机instrumentation通过。使用Android16完整镜像执行自动回归；实机以ADB触摸、截图和内存记录复验。设备的 `uiautomator dump` 被系统终止（137），本轮不声称完成语义树、读屏或无障碍合规验收。

验收边界：审批、队列真实执行及失败恢复、附件导入/保存、历史编辑提交、Sidechat和长期流式输出仍待真机端到端验证。本轮仅本机QA安装与源码交付，不发布客户端、不分配正式版本、不构建iOS或部署网关。

## 2026-11-11：Material 3 标准密度方案 B（已验证，未发布）

用户明确选择方案 B，参考 [hamen/material-3-skill](https://github.com/hamen/material-3-skill)，覆盖此前 Android 对齐 iOS 紧凑字号与留白的要求。开发基线为远端 main `31ec3510b50f321c47adee35323dd05a9f22c5a6`，使用独立工作树；实施范围与源码交付方式见[计划](plans/2026-11-11-android-material3-standard.md)。

- 主题改为标准 `Typography()`、`Shapes()` 和8/16/24dp间距，正文16sp/24sp、页头22sp/28sp、弹层标题24sp/32sp；富文本与 Compose 共用语义字阶和配对文字颜色。Android 12及以上继续动态取色，旧系统静态深浅色补齐同一蓝色种子的完整颜色角色。
- 侧栏最大360dp，保留56dp关闭区域；会话采用56dp单行/72dp双行最小高度，标准列表字号、胶囊选中底色和选中语义。修正页头重复安全区，统一消息、代码区和表单容器层级。
- 输入区按文字、模型/强度、固定工具分行；配置、复制、附件移除和队列操作至少48dp触区，停止/发送不受长模型名挤压。长队列补充区保持限高滚动，键盘打开后仍可操作。
- 设置开关和多选支持整行点击，子控件不重复分发命令；禁用状态整行生效。模型等菜单增加勾选、配对选中底色和可访问选中语义。

| 验证层次 | 本轮结果 |
| --- | --- |
| 工程与编译 | 完整 `npm run android:prepare`（含 TypeScript 与 Web 构建）、Kotlin 与 AndroidTest 编译通过。仅构建独立 QA 调试包用于 instrumentation，没有执行正式打包、签名、渠道发布或 iOS 构建。 |
| 共享业务回归 | 5文件128项全部通过：Android 接入合同、原生快照运行时/投影/工作区与设备工作流。未修改共享业务、网关或 iOS 呈现代码。 |
| 原生 instrumentation | Android 16 Google APIs、正常字号、竖屏下23项全部通过。覆盖标准输入区尺寸与分行布局、长模型菜单、固定停止/发送、侧栏与搜索、键盘长队列、新增整行开关/禁用/单次命令及菜单选中交互，同时保留既有输入、回执、上下文隔离、选文、富文本、真实内置 WebView 设备表单和弹层外观切换回归。 |
| 长队列物理可达性 | 真实打开输入法、滑动补充区，逐项断言重试/编辑/移除的完整边界位于可见滚动区内且不被输入区覆盖，再以真实触摸点击验证命令。最终专项与完整23项回归均通过；最初仅语义点击不足以证明可见，已加强用例。 |
| 颜色与视觉 | 静态浅深色共40组配对文字颜色的最低对比度为6.45:1。已检查[浅色会话](assets/android-native/2026-11-11-material3-standard/conversation-light.png)、[侧栏](assets/android-native/2026-11-11-material3-standard/sidebar-light.png)、[深色设置](assets/android-native/2026-11-11-material3-standard/settings-dark.png)、[长模型菜单](assets/android-native/2026-11-11-material3-standard/model-menu-dark.png)、[运行工具区](assets/android-native/2026-11-11-material3-standard/model-tools-dark.png)与[键盘长队列](assets/android-native/2026-11-11-material3-standard/queue-keyboard-light.png)完整截图。未进行帧率或性能基准测量。 |

日志保存在任务 worktree `.mobile-build/material3-standard/`，最终运行日志为 `native-final.log`、共享回归为 `shared-tests.log`。原生源码和测试模板与实际编译运行的生成工程逐文件一致。QA 使用独立身份 `vip.loock.codexmobile.material3qa`，只在生成目录关闭调试混淆，不进入正式 recipe。该阶段测试包与专用模拟器已清理，未操作连接的真机、未连接生产网关或创建真实测试会话；后续用户授权的真实网关实机巡查见首节。

本轮仅交付源码，未发布客户端或部署网关。本阶段未覆盖真机；后续独立QA安装和只读网关巡查见首节。正式应用覆盖升级、数据保留、壁纸取色偏好及发送等真实端到端交互仍待验收，不能由夹具或编译结果替代。

## 2026-11-11：页面布局与文字密度修正

本轮基线为 main `13679104e2a468443ee226ab9906c0dda5259565`，独立工作树分支 `fix/android-layout-alignment-20261111`。用户要求整体布局参考现有 iOS 原生版，修正稀疏、字号过大与文字显示不全；只调整 Android 呈现，保留 Material You 动态配色、既有业务及动效，未改 iOS 源码。

- 侧栏缩至4/5宽，搜索、刷新、更多和 Chat 合并到顶部；搜索按需展开，设备范围/全部设备、草稿、管理设备和设置收在菜单中。会话单行，运行/未读标记紧随标题，取消底部常驻操作。
- 输入区使用原生 BasicTextField，1至6行，去掉默认文本框多余留白；模型和强度独立选择，工具排列参考 iOS。长名称胶囊按可用宽度省略，菜单完整换行；仅选择区横向滚动，发送和停止保持独立。
- 正文15sp、列表正文14sp、页头16sp、弹层标题18sp；富文本与 Compose 共享系统/应用字号缩放。收紧消息间距、行距、表单分组和弹层边距；设置选择项横排，字段没有说明时不占用说明栏。
- 继续使用抽屉和弹层原生过渡、列表/展开/输入高度弹簧；搜索展开/收起也使用同一动效。系统栏图标跟随 App 有效深浅色，主窗口与业务底部弹层分别同步，退出呈现时恢复原窗口值。

本轮开发验证完成，未发布安装包，真机安装后的视觉与实际手感待验收。

| 层次 | 本轮结果 |
| --- | --- |
| 工程与编译 | 完整 `npm run android:prepare`（含 TypeScript 与 Web 构建）通过；更新模板后的接入幂等校验、Kotlin 与 AndroidTest 编译通过。没有执行正式 APK/IPA 打包或渠道发布。 |
| 共享业务回归 | 5文件145项通过，覆盖 Android 桥接、快照运行时、工作区、设备流程和原生投影。未修改共享业务或 iOS 源码。 |
| Android instrumentation | Android 16 Google APIs、正常字号、竖屏共21项通过。保留原17项输入/回执/选文/桥接回归，新增4项布局用例：常用模型与强度独立操作、长模型菜单与固定停止/发送、侧栏五条会话与搜索清空/全部设备、长队列错误及键盘边界。真实宿主设备表单还验证地址没有 Password 语义且完整显示明文；保持设置弹层打开切换深→浅→深，断言所有可见窗口的系统栏图标外观同步。 |
| 视觉与动效 | 已检查[浅色会话](assets/android-native/2026-11-11-layout/conversation-light.png)、[侧栏](assets/android-native/2026-11-11-layout/sidebar-light.png)、[深色设置](assets/android-native/2026-11-11-layout/settings-dark.png)、[长模型菜单](assets/android-native/2026-11-11-layout/model-menu-dark.png)、[运行工具区](assets/android-native/2026-11-11-layout/model-tools-dark.png)与[键盘及长错误队列](assets/android-native/2026-11-11-layout/queue-keyboard-light.png)完整截图。动效继续采用抽屉、弹层、搜索展开与内容弹簧；已在最终8项布局/界面用例录屏中复核抽屉进退、搜索展开/收起与弹层过渡，未进行帧率基准测量。 |
| 独立审查 | 已修复审查发现的“全部设备”入口遗漏和长队列错误挤压操作问题；最终复审未发现剩余确定的 Important/Critical。 |

键盘用例以真实点击打开输入法，断言根顶部保持0、页头可见、发送按钮完全位于键盘上方且贴近键盘上缘。最初测试 Activity 的声明为默认模式，启动后修改参数仍被系统自动选成 adjustPan，造成整页上移；现由仅 debug 的 manifest 在首次窗口 attach 前声明与正式 MainActivity 一致的 adjustResize。生产窗口、IME padding和网页模式没有因此修改，临时反射与诊断代码已清除。

本机完整证据保存在任务 worktree 的 `.mobile-build/android-layout-evidence/`，包含21项/145项测试日志、最终 `layout-motion-final.mp4`、抽帧总览与截图；生成工程使用独立 QA 身份 `vip.loock.codexmobile.nativeqa`。布局夹具不连接生产网关，真实宿主设备表单用例不保存测试设备，不创建后端测试会话；验证完成后清理测试包与独立模拟器，无需归档用户会话。

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
