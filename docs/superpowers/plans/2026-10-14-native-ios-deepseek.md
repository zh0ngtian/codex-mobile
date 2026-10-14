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

- [ ] 在 Vitest 写入失败测试：未知/重复命令、命令错误返回、原生运行时生命周期、纯快照无凭据、回合/列表/审批投影。
- [ ] 验证失败：`npm test -- tests/ui/native-ui-bridge.test.ts tests/ui/native-ui-projection.test.ts`。
- [ ] 实现只允许注册命令的 dispatcher 与可取消快照订阅。模型、会话、附件、队列、审批的动作连接已有控制器回调；面板数据用明确字段描述，不依赖 DOM 查询。
- [ ] 接入全部设备列表、项目/会话动作、编辑/重发、分页/搜索、Skill/插件、模型/权限、审批输入、工具/文件/变更面板；以功能清单逐项对照。
- [ ] 原生 store 在主 actor 接收快照；前台/后台传给同一 TS 运行时，隐藏业务 WebView 不触发错误的暂停逻辑。
- [ ] 运行上述测试、现有会话/审批/附件回归与 `npm run typecheck`，修复后提交。

## Task 3：双向切换检查点与启动恢复

- [ ] 先写失败测试：初次默认旧实现；普通前后台不切换；正文/附件/设备/项目/会话/设置检查点成功后才改变偏好；存储失败不改变；恢复不自动发送。
- [ ] 验证失败：`npm test -- tests/ui/native-ui-switch.test.ts`。
- [ ] 用现有草稿二进制序列化格式存储专用启动检查点，不污染用户手动草稿列表；启动恢复后不发送内容、不重放待确认写操作。
- [ ] 两套设置连接同一个偏好接口，显示下次启动生效。原生初始化错误页保留手动回旧界面入口。
- [ ] 验证 Web→原生→Web 和应用重启，运行相关回归、typecheck、构建契约并提交。

## Task 4：真实运行与无障碍/视觉回归

- [ ] 检查 iPhone 竖屏新对话/会话/抽屉/设置/输入与键盘、浅深色；其他尺寸不截断、不遮挡输入。
- [ ] VoiceOver 控件有名称，动态字号不截断核心操作，Reduce Motion 下取消抽屉大幅移动。
- [ ] 用独立测试会话验收发送、流式、停止、审批、历史/分页、附件/草稿、队列、工具与 Diff，结束及时归档。
- [ ] 新鲜截图与参考进行归一化对比，记录仅因 CM 功能/品牌差异而有意不同的区域。
- [ ] 可用真机时尝试安装/运行；安装签名与真机数据保留分别记录，不用模拟器结果替代。
- [ ] 先规格审查，再 SwiftUI 正确性/质量审查，所有真实问题解决后提交。

## Task 5：协调发布与交付

- [ ] `git diff --check`、必要客户端/构建/发布回归、`typecheck` 通过，保存四项 required checks 验证记录。
- [ ] 提交并推送固定 SHA，再 `releasectl ready`；不得自行创建正式版本或独立发包。
- [ ] 等待成功 batch receipt，核对 GitHub 双端、LAN APK/签名 IPA、HTTPS OTA、unsigned 软件源版本/中文日志。
- [ ] 回复固定 OTA 安装页、APK、IPA 链接与两端版本/大小/SHA-256、IPA 签名状态，说明默认旧界面及开关路径。

## 计划自检

每项用户需求均对应上面的任务；不含 DS 独有账号、点赞、分享链接、音色或语音模式。验证与发布不改写当前原生签名身份，不让未签名 IPA 覆盖固定签名渠道。未通过完整功能与切换验收前不将任务提交 ready。
