# WebUI 输入框补修与 GitHub 双端发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复附件加号偏移，统一现行 GitHub-only 规则，发布包含 WebUI 输入框对齐的 APK 与未签名 IPA，并验收既有 iOS 软件源。

**Architecture:** 复用已隔离的 `codex/web-composer-ios-alignment-20261114` 工作区，修改基线为 `fb9248ccdee5e3427a5e6796aa79353345985f9f`。附件入口使用与其余工具一致的 SVG，保留 34px 视觉圆与 44px 纵向触区。发布复用现有 `codex-mobile-github-only` 项目和共享 main 锁，仅由协调器整合、分配版本及执行 main/build/source/verify，不部署网关。

**Tech Stack:** React、CSS、Playwright WebKit、Vitest、Python unittest、releasectl、GitHub Actions。

---

## 任务 1：附件加号居中（TDD）

**Files:**
- Modify: `tests/e2e/composer.spec.ts`
- Modify: `src/ui/app-display.tsx`
- Modify: `src/features/conversation/ConversationPage.tsx`
- Modify: `src/styles.css`
- Modify: `tests/fixtures/native-menu/main.tsx`

- [x] 先新增 WebKit 用例，要求附件按钮的矢量图形中心与按钮中心在两轴上的偏差小于 0.5px，按钮仍为 34×44px；保存截图。运行 `npx playwright test --config tests/e2e/composer.config.ts -g '附件加号'`，确认旧版文字字形无法提供稳定图形中心，用例按预期失败。
- [x] 添加 24×24 viewBox 中心对称路径 `M5 12h14M12 5v14`，替换正文组件及历史夹具中的全角加号；与工具图标共用 20px 尺寸及居中样式。只改附件入口。
- [x] 再运行上述用例，确认通过并核对实际截图。运行完整输入框 WebKit 套件及已有 167 项组件/业务回归；不创建真实测试聊天。实际17项WebKit与167项组件业务用例全部通过，日志为`composer-webkit-green.log`与`composer-unit-green.log`。

## 任务 2：规则、交互约定与中文日志

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/interaction-alignment.md`
- Modify: `docs/release-coordination.md`
- Modify: `release/notes.md`

- [x] 规则明确：2026-11-14 用户再次确认现行 GitHub APK／unsigned IPA 及既有 iOS 软件源，旧 LAN／签名／OTA 规则失效；未来 Android 单端范围规则保留。将主工作区 `AGENTS.md` 同步为本次批准的现行规则，原有暂存内容前后SHA-256一致，见`primary-rules-sync.json`。
- [x] 交互约定写入加号使用居中 SVG 的要求、验收结果及实际发布状态；发布协调文档记录用户授权与任务 ID `web-composer-ios-alignment-github-only-20261114`。
- [x] 中文日志只列本版本用户变化：输入框上下布局、1至6行自适应、独立工具入口、回车与候选/中文组合输入保护、附件加号居中。相对最近实际版本 `v0.3.46` 核对范围；该版本之后仅有本次WebUI输入框来源`fb9248cc`及本次补修。

## 任务 3：门禁与协调发布

**Files:**
- Evidence: 本机 `ReleaseCoordinator/validations/web-composer-ios-alignment-github-only-20261114/`
- Coordinator generated: `.release-batch.json`

- [x] 持续 `releasectl heartbeat --task web-composer-ios-alignment-github-only-20261114`。运行并记录以下四项门禁的命令、退出码及日志 SHA-256：
  - `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`（adapter-regression）。
  - 在既有 release-coordinator 仓库运行 `python3 -B -m unittest discover -s tests -v`（coordinator-recovery）。
  - `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`（build-contract）。
  - `npm run typecheck -- --pretty false`（typecheck）。
  - 实际结果：273项适配器回归、59项协调器恢复、22文件164项构建契约及类型检查全部通过。
- [x] 阅读提交规范，运行 staged/unstaged diff 检查；提交修复与规则日志，推送独立分支固定 SHA。核对最新远端 main；若其运行代码变化，先整合并回归。validation.json 绑定固定 SHA 和实际证据。实际来源为`ee8d91d272d9f162a3b1e6f3d0b046934cf22596`，远端main未出现额外运行代码，冻结仅新增发布清单。
- [x] 执行 `releasectl ready --task web-composer-ios-alignment-github-only-20261114 --sha <实际40位提交> --validation <实际绝对路径>`。由协调器推进 main、构建同版本 APK/unsigned IPA、同步既有软件源并验证。批次`433ed0e5-e037-4af3-adeb-a65bfd59bf0e`已complete，冻结`248b05ebea81aa54f7642eec186f286618b8cb9e`，版本0.3.47／3047。
- [x] 每次使用不超过45秒的 `releasectl wait` 跟进，压缩输出到状态、批次、阶段和错误。暂时只读网络故障沿用同批恢复；实际失败保留现场，按同目标最新失败叶节点登记关联修复，不改数据库或借用旧包。实际首次批次成功，正式CI `43551720813`与开发CI `43551720743`均attempt 1成功，无关联修复链。

## 任务 4：成功凭证及交付

**Files:**
- Create: `docs/superpowers/plans/evidence/2026-11-14-web-composer-release.json`
- Modify: `docs/interaction-alignment.md`
- Modify: `docs/release-coordination.md`

- [x] 成功 receipt 核对任务包含关系、冻结 SHA、统一版本、平台与 main/build/source/verify；独立完整下载 APK 和 IPA，核对 GitHub 附件大小与 SHA-256、IPA 实际版本和未签名状态。共46项独立核对通过，APK还核对实际版本、居中SVG及六行布局。
- [x] 按现役上游说明核对既有软件源版本、unsigned URL、大小、散列、中文日志和开发者署名，不创建新订阅或修改服务部署；历史 LAN 包不改写、不启服务。
- [x] 保存脱敏证据，交互约定将本次范围标为已发布，保留真机键盘、覆盖安装与数据保留待验收边界；文档收尾只交源码，不另发版本。
- [x] 交付 GitHub Release、APK、未签名 IPA、iOS 软件源的可点击链接，以及本次实际文件大小和 SHA-256。
