# Apple Intelligence 图标与 0.3.0 版本起点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 使用用户选定的白底黑色 `apple.intelligence` 图标，将源码版本及后续发布起点设为 `0.3.0`，本次仅提交推送。

**Architecture:** Android、iOS 继续消费同一生产 PNG；仓库内保存用户确认的原图，原生成入口离线导出。版本分配沿用现有“最高已知版本加一”规则，将排除式下限设为 `0.2.999`，使当前 `0.2.191` 之后首次分配为 `0.3.0` / `3000`；该下限不是已发布版本，已有更高版本时仍继续递增。

**Tech Stack:** 原有 sharp、Vitest、Python unittest、Shell。

---

### 任务 1：图标和版本配置

涉及文件：`docs/assets/app-icon/apple-intelligence-symbol-1024.png`、`docs/assets/app-icon/codex-mobile-app-icon-1024.png`、同目录 `README.md`、`scripts/compose-mobile-app-icon.sh`、`package.json`、`package-lock.json`、`mobile-version-floor.json`、`src/features/update/useAppUpdate.ts`、`src/app-server/client.ts`、`mobile/ios/AppUpdateBridge.swift`、`release/notes.md`，以及对应图标、版本分配、更新控制器回归。

- [x] 复用已附加的干净独立 worktree，从 `origin/main` 创建 `codex/apple-intelligence-030-20261017`；原打包与版本契约 24 项通过。
- [x] 先修改图标回归以固定用户选定原图 SHA-256 `173f86a63e412af2d635f15d8ec4d8a3326cdfb8c95bb0af13b9caa08b366857`，生成结果与该原图解码后的像素一致；白色边缘和 RGB 无 Alpha 检查保留，黑色面积阈值适配新符号。
- [x] 增加真实版本回归：CLI 在现有 `0.2.191` 及空列表时分配 `0.3.0` / `3000`；高于起点的版本继续递增。Python 预留器读取仓库真实下限，验证同样结果与预留重用。为无桥接、无环境版本的更新控制器验证 `0.3.0`。
- [x] 运行以下命令，确认新要求在原实现上失败并保存 RED 日志：

  ```sh
  npm test -- tests/ci/mobile-packaging-recipes.test.ts tests/ci/mobile-build-workflow.test.ts tests/ui/app-update-hook.test.tsx --maxWorkers=2 --testTimeout=60000
  python3 -B -m unittest discover -s tests/ci -p test_release_adapter.py
  ```

- [x] 复制用户选定文件 `/Users/zhongtian/.codex/generated_images/apple-intelligence-icon-1024.png` 为新原图；更新脚本默认源和帮助信息并重新生成生产图。处理仍为 `sharp(source).flatten({ background: "#ffffff" }).removeAlpha().png().toFile(output)`，保持选定形状、比例和留白。
- [x] `package.json`、锁文件根包版本改为 `0.3.0`；前端显示、客户端握手和 iOS 缺失版本默认值同步 `0.3.0`。`mobile-version-floor.json` 设置 `{"version":"0.2.999"}`。保留历史版本测试夹具及既有冻结发布凭证。
- [x] 图标说明记录原始 SF Symbol、用户确认、原图散列与离线生成命令，并准确说明素材无阴影不代表 iOS 桌面不会自动添加效果。更新日志只记录图标更换及 `0.3.0` 起点。

### 任务 2：验证与源码交付

- [x] 重跑上述专项测试，随后运行 `npm test -- tests/ci tests/ui/app-update-hook.test.tsx --maxWorkers=2 --testTimeout=60000`、`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`、`npm run typecheck` 和 `sh -n scripts/compose-mobile-app-icon.sh`。
- [x] 依次进行规范与质量审查，修复发现的问题；确认 `.release-batch.json`、工作流和发布协调器运行配置均未变更。
- [x] 完成中文 Conventional Commit，正文包含新增功能和主要修改，执行差异检查并推送源码分支。本次不登记发布任务、不 ready、不创建版本标签，不执行客户端构建、签名、部署或更新渠道。

用户已确认使用此前生成的图标，并把原先 `0.2.0` 的要求改为从 `0.3.0` 开始；本次不发布的指令持续有效。不创建测试会话，不进行设备安装或桌面效果验收。

## 本次验证结果

2026-10-17：源码和客户端默认版本为 `0.3.0`，排除式门槛 `0.2.999` 在当前版本之后得到 `0.3.0 / 3000`，高于起点的版本仍递增。用户选定原图与生产图字节完全一致，SHA-256 为 `173f86a63e412af2d635f15d8ec4d8a3326cdfb8c95bb0af13b9caa08b366857`。

145 项构建契约和更新控制器回归、167 项 Python 发布回归、类型检查及 Shell 语法检查通过。独立规范及质量审查通过；新增 hook 测试显式清空环境版本，在外部 `VITE_APP_VERSION=0.3.5` 下 18 项通过。RED/GREEN 与完整验证日志保存在本机 `~/.codex/task-evidence/apple-intelligence-030-20261017/`。

本次仅提交推送源码分支，没有修改既有冻结发布清单、登记或就绪发布任务，没有构建或发布安装包，没有创建测试会话或执行设备安装。
