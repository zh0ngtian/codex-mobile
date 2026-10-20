# 表格与消息长按菜单双端发布实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 执行协调步骤；独立的更新日志准备使用 superpowers:subagent-driven-development，完成规格与质量两阶段复核。所有正式发布动作只由现役 releasectl 推进。

**Goal:** 将已合入 main 的表格布局与用户消息长按菜单修复发布到双端固定渠道，并核对成功凭证。

**Architecture:** 基线为 `7d372fa941cdb6b397552a71d6ea21274d2e72c2`，在独立托管 worktree 准备发布说明和验证证据。仅登记客户端目标 `codex-mobile-lan-production`；本次没有服务端变化，不部署网关。协调器持共享 main 锁整合固定 SHA、分配版本、冻结、构建、签名和发布，参与任务不直接发包或推进正式 main。

**Tech Stack:** SwiftUI／UIKit、Vitest、Python unittest、现役 releasectl、GitHub 双端 CI、Ad Hoc 签名与 HTTPS OTA。

---

### 1. 登记、隔离与基线

- [x] 记录 main 基线 `7d372fa`；登记任务 `table-message-menu-release-20261020`，持续每30秒 heartbeat。
- [x] 使用托管独立 worktree `/Users/zhongtian/.codex/worktrees/table-message-menu-release/codex-mobile`；不修改长期主工作区及生产配置。
- [x] `npm ci` 安装锁定依赖，`npm test -- tests/native-ui/agentapp-message-presentation.test.ts tests/ci/ios-native-ui.test.ts tests/ci/agent-session.test.ts tests/ci/selection-quotes.test.ts tests/ui/selection-quotes.test.tsx tests/ui/message-quotes.test.ts` 验证源码基线。
- [x] 复用开发阶段 TDD 证据：两项新增 UI 回归修改前复现失败，最终八项 iPhone17Pro／正常字号／竖屏用例通过，40项相关回归与类型检查通过；记录见 `docs/plans/2026-10-20-table-message-context-menu.md`，原始证据在长期主工作区 `.mobile-build/table-message-menu-20261020/`。本轮不再修改生产功能；若发现发布阻挡缺陷，先补失败回归再做最小修复。

### 2. 准备本版本更新日志

**Files:** 修改 `release/notes.md`，不改发布版本、冻结清单或签名材料。

- [x] 将文件完整替换为以下实际用户变化：

```markdown
- 修复会话表格长内容挤成窄列、换行后行高错误及内容重叠的问题，保持自然列宽和横向滚动。
- 用户消息气泡长按统一显示“复制、编辑、选择文本”，正文和留白均可触发；选择文本支持系统手柄与选文引用，复制保留完整原文，编辑仍在原消息位置进行。
```

- [x] 检查与 `7d372fa` 的实际改动一致，移除上一版本日志，不追加分发模板、版本占位或构建说明；完成规格与质量两阶段复核。
- [x] 使用中文 Conventional Commit 提交，正文包含“新增功能”和“主要修改”。

### 3. 本地发布门禁与 ready

- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_release_adapter.py'`，保存 `adapter-regression` 真实结果。
- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_release_read_recovery.py'`，保存 `coordinator-recovery` 真实结果。
- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'` 验证现有发布脚本集合。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，保存 `build-contract` 真实结果。
- [x] `npm run typecheck`，保存 `typecheck` 真实结果。
- [x] 将四项 required checks 与日志路径写到仓库外 `~/Library/Application Support/ReleaseCoordinator/validations/table-message-menu-release-20261020/validation.json`；不填写未执行或失败检查为 passed。
- [x] 推送准备提交的固定 SHA 到独立远端分支，确认远端精确 SHA；执行 `releasectl ready --task table-message-menu-release-20261020 --sha <实际SHA> --validation <上述文件>`。版本与 main 推进交协调器完成。

### 4. 正式发布与渠道回验

- [x] 使用 `releasectl wait --task table-message-menu-release-20261020 --timeout 45` 等待状态变化，每轮确认真实阶段；不重建数据库、不重复独立发包。
- [x] 确认 APK 与已签名 IPA 使用同一新版本，严格高于 Android／iOS 固定渠道、HTTPS OTA、GitHub 标签及已有预留版本；版本仅由协调器分配。
- [x] 核对同一批次的 main、GitHub 双端构建、设备构建、Ad Hoc 签名、HTTPS OTA、固定 LAN APK／IPA、软件源与 verify 成功；签名保持原 Bundle ID、application-identifier、Team 和完整钥匙串权限。
- [x] 核对软件源最新上游文档与现有 unsigned GitHub 订阅、实际中文更新日志、当前 gh 用户及既有开发者署名保留；已签名 IPA 不上传软件源。
- [x] 核对成功 receipt 的任务来源与冻结 SHA；独立读取固定 JSON、HEAD 与完整 GET，比较版本、实际字节数与 SHA-256，HTTPS 保留 TLS 验证。
- [x] 若批次失败，保留不可变失败记录；修复先失败测试后最小实现，并登记关联最新失败叶节点的修复任务，不 resume 失败批次或用 unsigned 包替代 signed 交付。

### 5. 交付收尾

- [x] 更新 `docs/interaction-alignment.md` 的本次已发布状态与成功凭证引用，保存公共验收证据到 `docs/superpowers/plans/evidence/2026-10-20-table-message-menu-release.json`；不复制私有材料。
- [x] 在共享 main 锁下整合并推送文档收尾，不修改冻结清单或重建安装包；停止 heartbeat，按托管工具归档已完成 worktree。
- [x] 最终回复提供固定 OTA 安装页、APK 与 Ad Hoc 已签名 IPA 链接、版本、实际字节大小和完整 SHA-256。真机覆盖安装与数据保留仍待用户验收，不把构建或模拟器当作该层验收。

## 发布准备检查

规格审查与质量审查均通过；质量复核建议补充的双端同版本及高于全部现役／预留版本要求已写入渠道清单。独立worktree的6文件40项基线回归、40项适配器回归、36项恢复回归、212项完整Python回归、20文件143项构建契约及类型检查均通过。`release/notes.md`已用真实读取器核对，GitHub当前登录用户与软件源原署名均为`zh0ngtian`，保持原署名。当前固定APK、固定已签名IPA及软件源unsigned版本均为0.3.19；正式分配版本以协调器冻结结果为准。

## 正式发布结果

已发布 **0.3.20（3020）**。客户端成功批次 `2c691254-6aa4-4c30-a20b-41290514f884`，任务来源 `5007c4e5212e85a4b505e2df44adb408596ab73b`，冻结提交 `4ed12e0e7fa720e3a25bb5b778f9206f0fa8b84c`，包含修复提交 `7d372fa`。四项required checks及212项完整Python回归通过；协调器整合验证通过，GitHub双端正式CI `39381136147` 成功，全部必要阶段与最终verify成功，无失败或关联重发批次。

GitHub APK／unsigned IPA、固定LAN APK／Ad Hoc已签名IPA、HTTPS OTA与软件源均已核对。独立完整GET确认APK为4,745,915字节，SHA-256为`bd309dfa76a14e11957cd035f976372b22fd7e1e4dea46569008a55cff820a07`；已签名IPA为4,834,512字节，SHA-256为`884c6ba4f26dee837bb676dc707a60591d0f134932abcd030910c170e1e39c28`。下载的IPA再次独立验签，Bundle ID、Team、签名App ID、完整权限散列和钥匙串组与上一成功版本一致。固定JSON、HEAD、完整GET、OTA manifest与安装页均核对通过，HTTPS保留TLS校验。软件源仅GitHub unsigned订阅，版本和中文日志与本次实际变化一致，保留原开发者署名。

本次无服务端改动，未部署网关；未执行真机覆盖安装和数据保留验收。未创建测试会话。收尾仅更新文档与公开证据，不修改冻结清单、不重建安装包；参与任务heartbeat在交接协调器后停止，工作区由托管入口归档。[公共发布凭证](evidence/2026-10-20-table-message-menu-release.json)。
