# Apple Intelligence Light 图标与新版发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 使用用户在字重对比中选定的 `apple.intelligence` Light 图标，发布一个高于现役 `0.3.0` 的新版。

**Architecture:** 继续使用双端共用的生产 PNG 与原离线生成入口，只替换为已确认的 Light 原图。由 `codex-mobile-lan-production` 协调 main 整合、版本分配、GitHub 双端 Release、Ad Hoc 签名、HTTPS OTA、固定 LAN 与 unsigned 软件源验收。

**Tech Stack:** 现有 sharp、Vitest、Python unittest、releasectl。

## 任务 1：Light 素材与回归（TDD）

文件：`docs/assets/app-icon/apple-intelligence-symbol-1024.png`、`docs/assets/app-icon/codex-mobile-app-icon-1024.png`、同目录 `README.md`、`tests/ci/mobile-packaging-recipes.test.ts`、`release/notes.md`。

- [x] 登记 `apple-intelligence-light-20261017`，复用干净 worktree 并创建独立分支，ready 前保持 heartbeat。
- [x] 在现有像素回归中将选图散列改为 `c3cd3925bd0edc9236a446f730ebaaaffb1dea773627fc4eb90e28c51b39d83c`，使用非空黑色面积检查，保留 1024×1024、RGB 无 Alpha、纯白边缘和生产图与源图全像素一致要求。先跑以下命令，确认旧 Regular 源图不满足新 Light 散列：

  ```sh
  npm test -- tests/ci/mobile-packaging-recipes.test.ts --maxWorkers=2 --testTimeout=60000
  ```

- [x] 将 `/Users/zhongtian/.codex/generated_images/apple-intelligence-weights/apple-intelligence-light-1024.png` 原样保存到源图路径，运行 `scripts/compose-mobile-app-icon.sh` 生成生产 PNG。保持原形状、字重、比例和留白。
- [x] 文档将 regular 更新为 light，记录新散列，准确区分素材与系统桌面效果。日志只写本版实际变化：“应用图标由 Regular 改为 Light 字重，线条更细。”不更改版本分配器、版本下限、源码默认版本或分发流程。
- [x] 重跑专项测试通过，保存 RED/GREEN 及图标像素证据，依次完成规范与质量审查。

## 任务 2：验证、提交与发布

- [x] 保存以下真实通过的检查，分别登记 `adapter-regression`、`build-contract`、`typecheck`；在现有协调器仓库运行恢复测试登记 `coordinator-recovery`：

  ```sh
  python3 -B -m unittest discover -s tests/ci -p 'test_*.py'
  npm test -- tests/ci --maxWorkers=2 --testTimeout=60000
  npm run typecheck
  # 工作目录 /Users/zhongtian/WorkSpace/release-coordinator
  python3 -B -m unittest discover -s tests -p 'test_*.py'
  ```

- [ ] 按中文 Conventional Commits 规范完成差异、暂存清单检查，提交并推送固定 SHA，再提交 ready。正式版本预期按现役版本递增到 `0.3.1`；实际版本以成功批次 receipt 为准。
- [ ] 等待 GitHub 双端构建和本机签名、各渠道及必要开发 CI 成功。确认冻结来源包含任务 SHA、图标为本次 Light 原图、签名身份与钥匙串组连续。
- [ ] 读取共同成功 receipt，独立核对 GitHub 标签、APK/unsigned IPA、固定 APK/已签名 IPA 的 HEAD/完整 GET、大小和 SHA-256，并核对 OTA 安装页及软件源同版本中文日志和署名。
- [ ] 保存并提交推送发布验收摘要；交付 GitHub Release、固定 OTA 安装页和固定 APK/IPA 的实际版本、大小、SHA-256 及 IPA 已签名说明。

本次只调整用户明确选择的图标字重。不创建测试会话，不执行设备覆盖安装，不将包内图标与渠道检查称为真机桌面渲染或数据保留验收。
