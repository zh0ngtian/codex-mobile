# 用量卡片与界面清理关联恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 按用户已确认的选择修复旧批次，将用量卡片与两套界面清理共同发布到双端渠道。

**Architecture:** 保留旧任务有效 SHA 和失败历史，关联最新失败叶批次创建修复任务；将旧任务后继提交合入当前独立分支并显式解决冲突。协调器先获取全部固定 SHA，再合并未被其他参与提交覆盖的 Git heads，冻结与凭证仍核对每个原任务为最终提交祖先。

**Tech Stack:** React/TypeScript、SwiftUI、Vitest、Swift SDK/XCUITest、现役 Python/SQLite releasectl。

## 已确认范围与失败证据

用户于本轮明确选择“修复旧批次并合入用量卡片功能，继续双端发布”。完整原生与当前非原生界面保留；新版 Web 和独立原生输入框不恢复。卡片保留五行：上下文余量、周期剩余、时间剩余、输入 Token（含缓存命中率）、输出 Token；沿用旧方案的 7 天/5 小时额度口径与 K/M 缩写。

旧失败叶批次为 `d4a8466f-087e-451f-9f13-704753535102`，原父批次为 `85f2355c-fc76-4c00-a635-a7271e1362e5`。现场只读确认 `release/notes.md` 合并冲突，未冻结或发布。旧任务来源为 `5430ca3`、`928ea6b`；界面清理来源为 `b5cfaf2`。现役协调器逐任务顺序合并，导致包含已解决冲突的后继提交尚未读取便再次失败。

## 任务一：整合已批准的两个功能

- [x] 先把旧用量卡片回归作为本分支新增测试运行，确认缺失字段和组件的 RED，保留日志。
- [x] 合并 `928ea6b081ea8e600f6b54b0ea69f3faeb90457c`，保留所有有效提交祖先；删除/修改冲突中继续删除 Modern*、web-ui 样式及混合输入桥，仅移植当前非原生与完整原生的用量展示。
- [x] 核对 `ConversationPage`、`ConversationControls`、新增 `ConversationUsagePopover`/`usage-metrics`、runtime投影/Swift DTO、原生卡片与样式消费者。保留卡片关闭、隐藏、上下文切换与焦点恢复行为；普通网页输入高度观察、检查点、原生偏好及人工恢复保持原实现。
- [x] 更新 README、原生桥接说明和中文 release notes，同时准确描述界面精简与五行用量；专用现代回归继续删除，保留两套现役回归。
- [ ] 运行新增用量回归与界面清理回归，确认 GREEN；运行 TypeScript、完整 Vitest、完整 NativeUI Swift SDK 类型检查。提交中文合并提交并推送固定 SHA。

## 任务二：修复协调器恢复合并顺序

- [ ] 在协调器独立 worktree 用真实 Git 历史复现旧任务冲突但后继修复提交已解决的场景，先观察失败。
- [ ] 获取每个任务固定 SHA，用 Git ancestry 选择需要实际合并的 heads；全部原任务仍留在冻结清单并通过祖先校验。保留独立任务的真实冲突、不存在提交、租约及响应丢失合同。
- [ ] 完成上游全量回归，规格/质量独立审查；按现役登录启动模式备份状态并升级不可变运行时，保留旧失败、运行时与远端 CI。核对实际运行服务版本/摘要。

## 任务三：联合验收与双端交付

- [ ] iPhone 17 Pro 正常字号竖屏，在离线生产 App 验证两个界面、两个用量卡片及唯一界面开关；卡片关闭/隐藏/切换不串会话，网页与完整原生输入仍可用。保存证据并清理 QA App/runner，释放共享模拟器；如创建真实测试会话及时归档。
- [ ] 必要发布门禁 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck` 全部真实通过；先规格审查再质量审查，推送并 ready 关联修复任务 `ui-usage-integration-repair-20261017`。
- [ ] 协调器生成成功子批次 receipt，逐项核对旧任务、界面清理来源和修复任务祖先；原界面清理登记归并到此凭证，不重复触发第二次发包。
- [ ] 核对双端统一新版本、GitHub unsigned IPA、已签名 HTTPS OTA/LAN IPA、APK 与软件源展示的中文更新日志、署名、大小和 SHA-256；独立 HEAD/完整 GET 回验后保存最终记录并交付固定链接。
