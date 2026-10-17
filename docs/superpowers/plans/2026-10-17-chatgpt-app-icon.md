# ChatGPT 手机图标替换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将双端 App 图标替换为用户手机截图中的白底扁平黑色 ChatGPT 标志，并完成默认双端发布。

**Architecture:** 双端构建保持读取同一现有 PNG 路径。仓库保存官方原件，原合成入口改为离线铺白导出 RGB PNG；不引入运行时逻辑或网关修改。

**Tech Stack:** Node.js、现有 sharp、Vitest、releasectl。

---

### 任务 1：图标资源与可重现生成（TDD）

文件：`tests/ci/mobile-packaging-recipes.test.ts`、`scripts/compose-mobile-app-icon.sh`、`docs/assets/app-icon/chatgpt-official-ios-1024.png`、`docs/assets/app-icon/codex-mobile-app-icon-1024.png`、`docs/assets/app-icon/README.md`、`release/notes.md`。

- [x] 在独立 worktree 创建 `codex/chatgpt-app-icon-20261017`，登记 `chatgpt-app-icon-20261017`，保持 heartbeat；安装锁定依赖，原打包契约 10 项通过。
- [ ] 将旧“裁切/渐变”实现断言改为实际资源像素断言：sharp 解码生产 PNG，检查 1024×1024、三通道、无 Alpha，外围 64 像素全白，纯黑像素超过 200000。旧图纯黑像素为 0，边缘存在灰色，应明确失败。
- [ ] 运行 `npm test -- tests/ci/mobile-packaging-recipes.test.ts --maxWorkers=2 --testTimeout=60000`，保留 RED 日志。
- [ ] 保存已下载原件 `/tmp/chatgpt-help-official-icon.png`，原件 SHA-256 为 `e799e2fa0d4149a2ec28fc595c8bfb4990bcbb478649791b42acff7cde6e805e`。来源为 `https://help.openai.com/en/articles/7905742-what-does-the-official-chatgpt-ios-app-icon-look-like`，原图为 `https://images.ctfassets.net/j22is2dtoxu1/intercom-img-d177d076c9a5453052925143/49d5d812b0a6fcc20a14faa8c629d9fb/icon-ios-1024_401x.png`。
- [ ] 将合成脚本简化为解析 `--output`、`--help`，默认输入仓库内官方原件，默认输出原 PNG 路径。Node 使用以下真实处理，不依赖本机 ChatGPT、ffmpeg 或在线下载：

  ```js
  import sharp from "sharp";
  const [source, output] = process.argv.slice(2);
  await sharp(source).flatten({ background: "#ffffff" }).removeAlpha().png().toFile(output);
  ```

- [ ] 执行生成脚本。加入生成测试：在带空格临时目录使用 `--output`，解码结果与官方原件铺白后的像素、生产图像素比较相等；`finally` 清理临时目录。检查失败参数明确报错，旧叠层参数不再受支持。
- [ ] README 记录用户截图依据、官方出处、原件散列、离线生成命令。`release/notes.md` 仅写“应用图标更新为与 ChatGPT 手机端一致的白底黑色标志，移除手机叠层和渐变效果。”
- [ ] 重跑打包契约并保留 GREEN 日志，查看生成图确认外观。完成规范审查后再进行质量审查；修复发现的问题。

### 任务 2：验证与交付

- [ ] 在仓库外持久验证目录保存日志和 validation.json。运行以下真实检查，均需退出码 0：

  ```bash
  python3 -B -m unittest discover -s tests/ci -p 'test_*.py'
  python3 -B -m unittest discover -s /Users/zhongtian/WorkSpace/release-coordinator/tests -p 'test_*.py'
  npm test -- tests/ci --maxWorkers=2 --testTimeout=60000
  npm run typecheck
  ```

  分别记录为 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`，并包含图标专项 RED/GREEN 结果。
- [ ] 阅读并遵循 `docs/commit-conventions.md`，执行 `git diff --check`、`git diff --cached --check` 和暂存清单核对。提交中文 Conventional Commit（正文含新增功能、主要修改），推送分支。
- [ ] 使用真实固定 SHA 和通过的 validation.json 执行 `releasectl ready`，等待成功 batch receipt。main 整合、版本分配、正式构建、签名与渠道更新都交给协调器。
- [ ] 核对 task SHA 包含证据、GitHub 双端 Release、固定 LAN APK/已签名 IPA、HTTPS OTA、软件源 unsigned 版本和中文日志；独立 GET 固定产物核对大小和 SHA-256。
- [ ] 将成功凭证摘要写入本仓库证据文件，勾选计划，提交推送。交付正文给出固定 OTA 安装页、APK/IPA 链接、实际版本、大小、SHA-256 和 IPA 已签名说明。停止 heartbeat。
