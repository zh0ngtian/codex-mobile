# 界面实现收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 删除新版 Web 和网页搭配原生输入框的两套实现，保留当前非原生与完整原生界面。

**Architecture:** 沿用现有 React 业务与原生 SwiftUI 呈现；删除已废弃的呈现分支及专用协议。只保留完整原生启动偏好，非原生使用正常网页 textarea；旧新版与 composer 偏好不再生效。

**Tech Stack:** React/TypeScript、SwiftUI/UIKit、WKWebView、Vitest、Swift SDK、XCUITest、现役 releasectl。

## 任务一：删除两个呈现分支（同一耦合改动）

**文件职责：**
- `src/App.tsx`、`src/main.tsx`、`src/features/web-ui/*`：移除新版 Provider、样式和专用焦点工具。
- `src/features/conversation/ConversationPage.tsx`、`ConversationControls.tsx`、`ModernConversationControls.tsx`：仅保留当前非原生布局及交互，删除现代化分支、混合输入代理和焦点交接。
- `src/features/threads/ThreadListPage.tsx`、`ModernSidebarHeader.tsx`：保留现有非原生列表、设备选择与草稿入口。
- `src/features/backends/BackendManagerSheet.tsx`、`ModernSettingsRoot.tsx`、`src/features/settings/ComposerSettings.tsx`、`ModernComposerSettings.tsx`：保留当前非原生设置与完整原生开关，删除新版与独立输入开关。
- `src/native-ui/{adapters,workspace-adapter,runtime,protocol,preference,switch-context,web-composer}.*`、`src/styles.css`、相关 i18n：删除混合模式专用命令、快照、监听与样式，保留完整原生 runtime 和检查点。
- `mobile/ios/NativeUI/{NativeUIBridge,NativeUIStore,NativeUIHost,NativeUITrust,NativeUIPreference,NativeSettingsView,NativeSnapshot}.swift`、`NativeWeb*.swift`、`mobile/ios/KeyboardDismissal.swift`、必要构建入口：删除网页原生编辑器、布局与偏好桥，保留完整原生输入框、文本选区和可信主文档校验。
- `tests/ui/*`、`tests/ci/*`、`tests/fixtures/*`、`mobile/ios/NativeUIUITests.swift`：删除专用模式用例与 fixture，保留两套现役界面有效业务回归。

- [x] 在 `tests/ui/ui-modes.test.tsx` 新增真实设置行为：localStorage 预留 `codex-mobile:web-interface=modern`，渲染 BackendManagerSheet 后仍是“管理设备”；不能出现“使用新版界面”或“使用原生输入框”。参考断言：

```tsx
localStorage.setItem('codex-mobile:web-interface', 'modern');
render(<BackendManagerSheet open registry={registry} summaries={{}} onChange={() => {}} onClose={() => {}} />);
expect(screen.getByRole('dialog', { name: '管理设备' })).toBeVisible();
expect(screen.queryByLabelText('使用新版界面')).toBeNull();
expect(screen.queryByLabelText('使用原生输入框')).toBeNull();
```

- [x] 新增旧 composer 启动标记不能激活 runtime 的行为回归；保留原生启动与恢复的正向测试。Swift 偏好 smoke 验证旧 composer 值不改变原生界面选择。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/ui-modes.test.tsx --maxWorkers=2`，保存因旧实现不满足要求而失败的 RED 日志。
- [x] 最小删除上述分支、协议和专用文件，将当前非原生分支提升为唯一 Web 实现。不得将 `modern=false` 或 `composer=false` 的失效开关和死代码留在运行代码中。
- [x] 更新受影响回归，验证网页输入、发送、附件、菜单与草稿和完整原生切换/检查点仍有效。运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=2`、`npm run typecheck`，预期全部通过；检查完整 NativeUI 的 iOS SDK 类型检查。
- [x] 运行 `git diff --check` 并自审；使用中文 Conventional Commit，正文包含“新增功能”“主要修改”。不得自行正式发布。

## 任务二：文档、审查、验证与交付

- [x] 更新 README、桥接说明与中文 `release/notes.md`，准确写明仅保留两个界面、原生切换生效时机和已确认升级行为。
- [x] 先由独立审查核对删除范围、升级行为与保留功能，再审查代码质量并修复实质问题。
- [x] 排队取得共用模拟器使用权；iPhone 17 Pro 正常字号竖屏验证网页 textarea 和完整原生输入、设置中唯一界面开关、旧偏好升级；使用离线 QA fixture。释放模拟器、卸载 QA App；真实测试会话如有则归档。
- [x] 执行发布门禁：`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`（adapter-regression）、现役协调器恢复回归（coordinator-recovery）、`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2`（build-contract）、`npm run typecheck`（typecheck），保留命令、退出码和完整日志。
- [x] 提交并推送固定任务 SHA，生成真实 validation.json 后 ready；持续 heartbeat，等待所在双端批次成功 receipt。
- [x] 核对 receipt 的 SHA/任务祖先、双端产物、签名、固定 LAN 与 HTTPS OTA、软件源 unsigned 版本和中文日志。以固定清单、HEAD 和完整 GET 再次核对版本、大小和 SHA-256。
- [x] 保存验收记录并提交推送；归档本次隔离工作区。最终回复提供固定 OTA 安装页和本次 APK、已签名 IPA 的固定下载链接、版本、大小和散列。

## 本地验证记录

源码提交 `0427c0c`；全量129文件1394项、TypeScript、完整NativeUI iOS SDK与XCUITest源码类型检查通过，发布适配器166项和现役协调器恢复35项通过。iPhone 17 Pro正常字号竖屏的最终3项离线UI验收全通过，运行源码散列前后相同；仅保留的UI测试固定坐标改为标签定位，未改变App代码。QA App与runner已卸载，锁已释放，无远端测试会话。详见[验收摘要](evidence/2026-10-17-remove-ui-variants.json)。独立审查与正式双端协调发布仍在进行。

## 正式联合交付完成

2026-10-17 已通过关联修复批次 `d5a83a02-263f-4e7d-9899-9dca506733ce` 完成双端 `0.2.190`（2190）发布。冻结提交为 `c18ece3359a7bad7a8c7097c9e4546798b6326d4`，保留旧用量两个任务和本次界面清理的全部来源；旧用量任务均 recovered 到同一成功凭证。原界面清理登记已归并到关联修复任务，不再单独重复发包。

协调器0.1.6已审查、升级并实际完成关联恢复，17个旧失败批次完整行未变。GitHub双端、固定LAN APK/已签名IPA、HTTPS OTA、软件源unsigned订阅及必要开发CI均验收成功。父任务再次对固定JSON、HEAD和完整GET、OTA安装manifest及签名身份连续性完成独立核对；软件源版本、构建号、URL、大小、散列、中文日志与动态读取的当前GitHub署名一致。

[固定OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)

| 产物 | 版本 | 大小（字节） | SHA-256 |
| --- | --- | --- | --- |
| [APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) | 0.2.190 | 4754387 | `8e10229afebcbe8ecb982a705b6261b7bddff1e87a04548b32048a8c5c85204b` |
| [IPA（Ad Hoc已签名）](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) | 0.2.190 | 4847522 | `f7f53fc5ada000741bdb1812e14c53abd83af281a82218297d669f6e7c0fedb3` |

五项最终联合模拟器验收及1486项回归已通过；所有QA使用离线内存数据，无远端测试会话。QA App/runner已卸载、锁已释放，本次受管worktree已归档，上游修复worktree已清理，必要原始证据均保存在仓库外长期目录。未进行真机覆盖安装及数据保留验收。
