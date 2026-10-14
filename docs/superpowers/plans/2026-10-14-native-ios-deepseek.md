# Codex Mobile 原生 iOS 界面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iOS 18+ 提供参考 DeepSeek 截图的 SwiftUI 原生界面，覆盖 CM 现有可见功能，保留默认旧界面及下次启动生效的双向切换。

**Architecture:** 原生 SwiftUI 负责导航、抽屉、消息、输入与设置；已有 TypeScript 业务通过显式命令/快照桥接共享，沿用同一 WKWebView 数据域和发送去重机制。同一启动只拥有一个业务运行实例，原生模式不通过 DOM 点击操作旧界面；复杂 Mermaid/HTML 内容允许隔离 WebKit。偏好在原生启动时读取，切换前先保存当前输入与附件；保存失败不改变偏好。

**Tech Stack:** SwiftUI、Observation、WebKit、TypeScript/React 现有控制器、Vitest、XCTest、现有 PakePlus recipe 与 releasectl。最低 iOS 18，不引入第三方库，不新增语音入口。

---

## 用户已确认的范围

- 参考抽屉位移/缩小、轻量顶部控件、底部输入卡片、用户气泡/助手开放正文及分组设置；品牌、文案与功能语义使用 CM。
- 全部/单机、多设备/项目、关注/未读/搜索、会话管理、草稿与附件、模型/推理/服务档位/权限、Skill/插件、审批、队列、运行状态、工具/计划/变更/文件预览、通知/更新及重连均需保留。
- 旧界面实际没有语音启动入口；原生也不添加。无需删除底层 realtime 代码。
- 首次启动默认旧界面，两边设置均有开关，下次完整启动生效；不因普通前后台切换切换实现。
- iPhone 竖屏为主要视觉基准，保留 iPad/横屏布局，系统深浅色与现有语言、字号设置。

## 文件职责与桥接契约

- `mobile/ios/NativeUI/`：每个 Swift 类型单独文件；设计 token、可观察 store、快照数据、原生页面、原生面板与独立富文本内容视图。
- `src/native-ui/`：命令/快照协议、桥接生命周期、偏好/切换检查点及纯数据投影。
- `src/App.tsx`：在已有控制器边界发布数据和显式回调，不复制协议/发送业务。
- `src/features/backends/BackendManagerSheet.tsx`：旧设置中的原生开关。
- `src/main.tsx`、`src/backends/http-transport.ts`：原生运行时握手与前后台信号。
- `mobile/ios/build-recipe.yml`、`scripts/configure-ios-tests.rb`：安装原生源码、根容器、最低系统与方向，保持发布/签名身份。
- `tests/ui/native-ui-*.test.ts*`、`mobile/ios/NativeUIUITests.swift`：协议、切换持久化、业务投影与原生 UI 验收。

桥接只接收协议版本 1 的 `{id,name,params}` 命令，返回带同一 id 的结果；快照必须是可序列化的纯数据。Swift 调用原生命令处理函数，不调用 DOM `.click()`。命令执行失败显示具体错误；待确认写入沿用现有 UUID，不另建发送链路。

## Task 0：先修复既有基线失败（用户追加要求）

- [x] 以已有 Node 24 运行完整旧基线：1060 项通过、6 项失败；默认 Node 26 的 localStorage 差异另行排除，不修改产品代码规避环境问题。
- [x] 恢复回合中被过滤掉的独立媒体：多张过程截图独立懒加载折叠、生成图片/视频、图像失败详情；保持过程文字只统计 commentary。
- [x] 修正过时的复制测试夹具与全局 interval 断言，保留托管队列 2 秒同步及真实产品语义。
- [x] 新增失败回归覆盖运行中媒体及分类/去重，先红后绿；完整旧基线 103 文件 / 1074 项及 typecheck 全部通过。日志保留在 `.mobile-build/native-reference/turn-media-*.log`。
- [x] 规格与质量审查后单独提交修复 `0160a74`、`bdae796`，继续 Task 1；与原生界面同一发布任务整合，尚未完整验收不 ready。

## Task 1：参考归一化与原生静态基准

- [x] 记录 `docs/research/deepseek-ios-2026-10-14/native-implementation-design.md` 的全图清单、测量、采色、文案映射及不确定值。
- [x] 先创建 UI 验收断言：原生根标识、侧栏开关、输入框、新对话、设置、没有语音入口；CI 与位置回归均实际观察 RED。
- [x] 添加分文件的设计 token、静态快照、原生根、消息/输入卡片、抽屉和设置。用显式 `--native-ui-reference` 参数展示离线基准，不挂载业务 WebView、不联网。
- [x] 配置生成工程安装这些文件，使用 iOS 18 与当前可用 SDK；每窗口独立桥/store绑定原有唯一 WebView，模式在进程启动时冻结，默认旧界面。
- [x] 独立 iPhone 16 Pro / iOS 27 simulator 编译、四轮402pt并排与叠图校准；修正短内容贴底、上下8pt偏移、正文/标题字号与块间节奏。对照只代表静态基准，不代表完整业务验收。
- [x] 最新四项原生 UI 测试全通过，91项构建契约及 Swift/TS 类型检查通过；规格和质量独立审查均通过。提交从 `f442571` 到 `6b0c1db`。

## Task 2：共享业务快照与显式命令

### Task 2a：基础会话与导航

- [x] dispatcher 白名单、参数校验、上下文隔离、请求 UUID 去重及可取消订阅；慢发送不阻塞停止和继续输入。
- [x] 接入真实设备/项目/会话列表、搜索与管理、发送/停止、模型/推理、附件/位置、Skill/插件、队列和基础工具/变更面板。
- [x] 原生 store 使用草稿与字段版本回执，保留 UTF16 光标、消息复制、原图预览导出、上翻阅读位置和分页锚点。
- [x] scene 前后台信号复用原 TypeScript 运行时，同一 scene 只有原有 WKWebView 业务拥有者。
- [x] 修复双 UUID 同批发送与快速 ACK 造成的重复启动；同步消费草稿并保持期间新输入及既有托管队列。修复原图与缩略图混用。
- [x] 修复 Swift 输入清空后的旧光标越界崩溃、重命名缺少输入、队列缺少发送入口和成功重试后残留错误。
- [x] 112 文件 / 1130 项全量测试、Swift/TS 类型检查通过；最新 7 项原生 UI 测试通过，含排队/停止、历史阅读及原生重命名输入框。日志保留在 `.mobile-build/native-reference/task2a-*.log` 与 Xcode test result bundle。

### Task 2b：补齐既有功能面板

- [x] 模型服务档位、权限与会话状态、审批及问题输入、历史编辑和队列的完整状态管理。
- [x] 设备 CRUD/探测/扫码、草稿列表及恢复、语言/字号/传输/通知/更新设置。
- [x] 工具/计划/文件/变更详情、Markdown 与远程富内容预览；逐项对照原有可见功能，不新增 DeepSeek 独有功能。
- [x] 每个模块先失败回归，再实现，再规格/质量审查；完成聚焦与全量验证后提交。

验收补充：117 文件 / 1176 项完整 TS 测试及真实快照跨 Swift 解码通过；15 项 `NativeUIUITests` 在 `test_sim_2026-10-14T13-46-59-032Z_pid23807_736d60a7.xcresult` 中全部通过。此次无筛选运行还包含 8 项旧 UI 用例，其中 7 项未通过，不能把整个 result bundle 称为全绿；旧用例需配合其网关/启动环境另验。重命名输入后取消与保存均通过，撤回未验证的生产弹窗改动，保留关闭动画等待和取消回归。Task 2b 规格与质量审查均批准 `a803757`；这仍不代表 Task 3 切换或真实端到端已完成。

## Task 3：双向切换检查点与启动恢复

- [x] 先写失败测试：初次默认旧实现；普通前后台不切换；正文/附件/设备/项目/会话/设置检查点成功后才改变偏好；存储失败不改变；恢复不自动发送。
- [x] 验证失败：`npm test -- tests/ui/native-ui-switch.test.ts`。
- [x] 用现有草稿二进制序列化格式存储专用启动检查点，不污染用户手动草稿列表；启动恢复后不发送内容、不重放待确认写操作。
- [x] 两套设置连接同一个偏好接口，显示下次启动生效。原生初始化错误页保留手动回旧界面入口。
- [x] 验证 Web→原生→Web 和应用重启，运行相关回归、typecheck、构建契约并提交。

整合验收：真实 iPhone 16 Pro / iOS 27 模拟器完成 native→native→Web→native 的完整进程重启，正文和本地选图附件均保留、当前启动保持原界面；最终清理测试输入并保存回旧界面偏好。`test_sim_2026-10-14T14-42-05-393Z_pid23807_066029d3.xcresult` 通过。iOS 27 WebKit 在设备设置弹层未返回 checkbox AX 节点；该一步按新鲜截图的可见位置实际点击，并等待仅 DEBUG 的宿主保存值探针确认，然后以冷启动原生根与内容验证结果。未用 DOM 点击或测试直接写偏好代替用户切换。Task3 规格、质量与最终整合只读审查均通过。

## Task 4：真实运行与无障碍/视觉回归

- [x] iPhone 竖屏新对话/会话/抽屉/设置/输入及横屏操作通过，深色与系统无障碍大字号的设置/横屏输入用例通过；iPad真实构建运行截图核对基本布局。
- [x] 静态与运行时AX核对控件名称，动态字号核心操作仍可达；Reduce Motion取消大幅位移。未声称真机VoiceOver手势已验证。
- [x] 独立真实网关会话完成发送、回复与归档，切换中的图片和正文真实重启恢复；审批、历史/分页、队列、工具与Diff采用实际App控制器回归和原生富内容参考用例分层覆盖。
- [x] 更新新鲜402pt并排对照及叠图，保留CM模型/推理/Skill入口、移除DeepSeek独有操作的有意差异。
- [x] 真机连接检查仍为unavailable；没有把模拟器或设备构建当作覆盖安装和数据保留验证。
- [x] 规格、SwiftUI质量与最终整合审查通过；修复发现的输入旧绑定、切换未就绪超时、已有线程恢复配置覆盖及发布日志缺失问题。

详见 `docs/research/deepseek-ios-2026-10-14/native-validation.json`。旧Web的安全区与URL连续收键盘回归通过；两个旧中文输入/发送自动化在iOS27仍存在基线焦点时序失败，原ZStack无原生宿主对照同样复现，未记为通过。键盘34pt假阳性已用真实逐帧采样替换旧瞬态viewport推算，严格阈值和真实尾跳正对照均保留。

## Task 5：协调发布与交付

- [x] `git diff --check`、121文件/1214项全量、106项本机默认Node构建契约、157项发布Python、30项协调恢复及typecheck通过，保存四项required checks日志；ready文件绑定随后推送的固定SHA。
- [ ] 提交并推送固定 SHA，再 `releasectl ready`；不得自行创建正式版本或独立发包。
- [ ] 等待成功 batch receipt，核对 GitHub 双端、LAN APK/签名 IPA、HTTPS OTA、unsigned 软件源版本/中文日志。
- [ ] 回复固定 OTA 安装页、APK、IPA 链接与两端版本/大小/SHA-256、IPA 签名状态，说明默认旧界面及开关路径。

## 计划自检

每项用户需求均对应上面的任务；不含 DS 独有账号、点赞、分享链接、音色或语音模式。验证与发布不改写当前原生签名身份，不让未签名 IPA 覆盖固定签名渠道。未通过完整功能与切换验收前不将任务提交 ready。
