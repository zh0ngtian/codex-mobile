# 输入区发送按钮定位与正式发布计划

目标：按用户两张参考图调整发送按钮位置，完成验证后通过现役协调器合入 main，并发布 GitHub Release 与仓库默认配套渠道。

执行方式：复用现有独立 worktree，依照计划顺序执行，使用 TDD 验证输入框几何行为；正式 main、版本和发布由 releasectl 处理。

## 参考图归一化

两张原图分别为 750×124px、876×232px 的输入区裁图，不含完整设备与安全区，无法直接声明设备倍率。两图粉色按钮直径约 64px；以当前 34pt 按钮归一化，推断倍率约 1.88px/pt。按钮与外框右边缘约 24px，按钮在收起框中垂直居中，展开后距底边约 24px；边缘受阴影和裁图影响，数值为推断。目标：右间距12pt，收起高度58pt（按钮上下12pt），展开下间距13pt。保留现有图标、按钮尺寸、模型与强度、默认触感及 Show Borders 修复。

## 步骤

- [x] 在 DEBUG 回归参数下记录输入区真实几何范围，添加收起/展开位置回归；修改前确认几何断言失败。
- [x] 只调整输入框行高、右侧及底部内边距，确认新测试与原有输入/发送/停止流程通过，截图核对两种状态。
- [x] 更新交互约定与本次中文 release/notes.md；完成 adapter-regression、coordinator-recovery、build-contract、typecheck 和 iPhone 17 Pro 验证。
- [ ] 提交并推送精确 SHA，提供真实验证记录后 ready；等待协调器整合 main、冻结版本与双端构建、签名、GitHub/LAN/OTA/软件源验收。
- [ ] 核对共同 receipt、main 祖先关系、GitHub Release、固定安装页和下载数据后交付。

发布任务：ios-composer-inset-release-20261018；目标：codex-mobile-lan-production。持续 heartbeat，使用仓库默认发布范围。不得手工替代协调器推送 main、改版本或独立发包。新发布版本由协调器统一分配。

## 本地验证结果

2026-10-18：adapter-regression 167 项、coordinator-recovery 42 项、build-contract 137 项及 typecheck 均通过；额外原生代码回归154项、iPhone 17 Pro界面回归25项通过。几何断言先红后绿，独立只读审查无阻塞问题，README旧菜单说明已同步。正式发布结果以协调器成功receipt为准。

## 发布中发现的 SDK 兼容问题

首批 b899793a… 在读取 GitHub API 时因 EOF 失败，关联批次 f267250c… 仍在构建。云端首批 iOS 编译日志确认 `DeviceStatusBadge.statusLabels` 的 `@ContentBuilder` 不被 Xcode 26.3/iOS 26.2 SDK 识别，而本机 SDK 的 Release 编译通过，说明模拟器调试构建不足以证明云端 SDK 兼容。按实际编译失败作为红灯，改用既有 `@ViewBuilder`，不调整业务或界面，并追加 Release 编译与现役必需检查。最终修复任务须绑定最新失败叶节点，不能重跑或改写旧失败批次。

兼容修复后本机 Release 模拟器整 App 编译通过；167项适配器、42项协调恢复、137项构建契约及typecheck重新通过。独立只读审查无阻塞问题。云端 SDK 兼容性最终以新批次实际编译通过确认。
