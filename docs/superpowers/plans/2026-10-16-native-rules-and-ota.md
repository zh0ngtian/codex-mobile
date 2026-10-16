# 原生行为规则与独立 OTA 协调目标

> **For agentic workers:** 使用 Superpowers TDD 与独立问题域分工；实现后分别核对规格和代码质量。用户已确认原生原位编辑、iOS 不检查更新、独立 OTA 目标。

**Goal:** 让原生历史编辑、iOS 更新行为和发布协调器符合用户明确选择，并用真实 OTA 批次完成源码整合与交付。

**Architecture:** 继续复用历史编辑的单一业务拥有者及 history.change/cancel/submit；原生只改变呈现位置。iOS 保留原生版本读取，完全停止 App 内检查/通知/安装触发，Android 保持现状。协调器新增独立项目，沿用现有状态库、main 锁、冻结、设备构建、签名及固定渠道阶段。

**Tech Stack:** React/TypeScript、SwiftUI、Vitest、Swift smoke/XCTest、Python unittest、现役 releasectl。

## 一、原位历史编辑

文件：`src/native-ui/workspace-panels.ts`、`workspace-adapter.ts`、`protocol.ts`；`mobile/ios/NativeUI/NativeMessageView.swift`、`NativeRootView.swift`、编辑展示模型及组件；`tests/ui/native-ui-workspace.test.tsx` 或对应历史编辑测试、Swift smoke、XCTest。

- [x] 先增加失败测试：编辑目标精确匹配 turn/message，非目标消息不变；输入回调仍携带 editKey/context；提交失败保留文字与附件；有后续对话保留显式确认，取消确认返回原位。
- [x] 在原消息位置呈现原生多行输入、取消及保存重发，保留附件和此前消息提示；普通历史编辑不再打开 sheet，破坏性确认继续使用原生确认界面。
- [x] 编辑中和过期上下文的禁止操作沿用原业务限制；键盘、滚动定位、动态字号可用。
- [x] 执行对应 Vitest、Swift smoke 和实际原位编辑 UI 流程，确认没有真实远程发送。

## 二、iOS 完全停止更新检查

文件：`src/features/update/useAppUpdate.ts`、相关 UI/原生设置版本入口、更新回归测试。

- [x] 先验证红灯：iOS 启动、回前台、显式 check(true)、原生更新事件均不能请求更新源或显示升级面板；install 不调用 OTA 桥。
- [x] 保留真实当前版本显示；iOS 版本行不再是“检查更新”按钮，旧界面与原生界面一致。
- [x] Android 自动/手动检查和下载校验测试继续通过；网页无更新能力时保持现状。

## 三、独立 OTA 目标

文件：`scripts/codex_mobile_release_adapter.py`、`scripts/release_coordination/`、`scripts/validate-release-batch.mjs`、`release/coordinator.ios-ota.example.json`、对应 Python/Vitest 构建契约测试。

配置：项目 `codex-mobile-ios-ota-production`、target `vip.loock.codexmobile`、environment `ota-production`、共用锁 `codex-mobile-main-production`；phases 为 `main, iosbuild, sign, ota, ipa, verify`，options.kind 为 `mobile-ota`。

- [x] 测试先行：新目标冻结清单必须输出 release_required=false，仍严格核对版本、构建号、目标、scope 和任务祖先；现有双端与网关目标不受影响。
- [x] Adapter 识别 mobile-ota；版本分配继续高于所有渠道及历史预留；verify 仅要求对应阶段和开发 CI，不能调用 GitHub Release/APK/软件源阶段。
- [x] 检查和执行入口都拒绝 OTA 目标调用 build/apk/source/gateway；签名身份检查仍要求真实 Bundle ID。
- [x] 发布凭证明确分发范围、来源 SHA 和未执行渠道；保留 0.2.179/180 旧独立凭证，用祖先关系证明本批纳入其源提交，不伪造历史批次或历史冻结 SHA。
- [ ] 完成本地 adapter-regression、coordinator-recovery、build-contract、typecheck 后推送固定 SHA，调用 ready；等待真实成功 receipt。

## 四、规则与交付

文件：`AGENTS.md`、`README.md`、`docs/release-coordination.md`、`docs/native-ui-business-bridge.md`、`docs/ios-ota-release.md`、`release/notes.md`。

- [x] 移除现役文档中 iOS 自动/手动检查声明，明确从固定 OTA 安装页更新；历史记录保留日期和历史语义。
- [x] 原生历史编辑文档改为原位，确认流程及附件保留规则一致。
- [x] 明确默认双端目标与用户指定 OTA-only 的独立目标、阶段、验证及交付范围；不恢复失效的全局规则引用。
- [ ] 独立复核已签名 IPA、HTTPS OTA 与固定 IPA 的 JSON/HEAD/完整 GET、大小及 SHA-256；GitHub/APK/软件源不发布。
- [ ] 保存批次凭证，提交推送文档；不把模拟器验证当作真机覆盖安装和数据保留验收。

任务已登记 `native-rules-ota-20261016`，现役协调器持续 heartbeat；未 ready 前不会开始发布。

## 本地验证与用户收尾要求

- 已完成：全量 Vitest 124 文件/1311 项、Python 发布回归166项、现役协调器恢复30项、TypeScript检查；原位编辑取消/确认重发/失败保留三个模拟器流程通过，静态版本行通过。
- 后续质量复核补充6个重连/迟到确认回归，均已红→绿；此前7个跨会话回归继续保留。截图在 `/Users/zhongtian/.codex/visualizations/2026/10/16/01a1433c-545b-78c0-9522-eb1bcb3cf80d/native-rules/`。
- 用户随后明确要求“先别测试了，快速收尾”。最后一处非当前会话终态保护仅做静态复核，未再追加或运行测试；不把此前全量结果冒充该最后改动后的重跑结果。发布协调器固定的冻结验证、构建、验签及渠道回验继续保留。
- 任务和源码交付以成功批次 receipt 为准，完成后补记实际冻结 SHA 与版本。
