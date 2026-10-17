# 基于 4ca6b4d 的 GitHub Release 发布计划

> 执行流程：superpowers:writing-plans、superpowers:test-driven-development、superpowers:verification-before-completion。源代码已按 TDD 完成，本轮只复核并发布该固定提交，不新增运行行为。

**目标：** 基于用户指定的 `4ca6b4d6b728ce3e7f00727b459eafc0b27081ca` 创建 GitHub 双端 Release，沿用默认客户端协调目标完成所需渠道验收。

**架构：** 复用 `codex-mobile-lan-production`，由协调器整合来源、分配版本并生成冻结清单。GitHub 附件为 APK 和 unsigned IPA；本机 Ad Hoc IPA 仅交付 HTTPS OTA 与固定 LAN。任务来源保持用户指定 SHA，冻结清单提交不改变其运行代码。

**版本与日志：** 源码版本 `0.3.0`，排除式门槛 `0.2.999`；若没有更高的现役版本或保留版本，下一次分配为 `0.3.0 / 3000`。日志读取该来源提交中的 `release/notes.md`，仅描述白底黑色 `apple.intelligence` 图标和版本起点。

## 验证、执行与验收

- [x] 核对 worktree 干净，HEAD 为指定 SHA，远端 main 为该提交的祖先，原图标和版本 TDD 证据可定位。
- [x] 登记任务 `apple-intelligence-030-release-20261017`，在 ready 前持续 heartbeat。
- [x] 在固定来源执行并保存真实通过的检查：

  ```sh
  python3 -B -m unittest discover -s tests/ci -p 'test_*.py'
  npm test -- tests/ci tests/ui/app-update-hook.test.tsx --maxWorkers=2 --testTimeout=60000
  npm run typecheck
  ```

  在现有协调器仓库运行 `python3 -B -m unittest discover -s tests -p 'test_*.py'` 验证恢复契约；四类结果分别登记为 `adapter-regression`、`build-contract`、`typecheck`、`coordinator-recovery`。本轮不重写已完成的图标或版本实现；原 RED/GREEN 位于 `~/.codex/task-evidence/apple-intelligence-030-20261017/`。

- [x] 核对远端固定 SHA 可用，提交 ready，等待批次分配和冻结。签名、版本预留、main 推进和渠道写入全部由协调器完成。
- [x] 等待同一冻结 SHA 的开发检查、正式双端构建和 GitHub Release；核对 Release 标签指向冻结 SHA，APK 和 unsigned IPA 及回执包含指定来源，中文日志正确。
- [x] 等待本机 iOS 构建、Ad Hoc 签名、HTTPS OTA、固定 APK/IPA 和软件源 unsigned 同版本同步；保留原 Bundle ID、Team、application-identifier 和完整权限。
- [x] 在 task 与 batch 成功后读取同一 receipt，核对任务 SHA 包含证据及每个必要渠道。独立 HEAD 和完整 GET 校验 GitHub、LAN 及 OTA 包大小和 SHA-256；核对源内版本、中文日志、unsigned URL 与开发者署名。
- [x] 将验收摘要和本计划提交推送，交付 GitHub Release 与固定安装、下载链接，明确 IPA 签名状态及未执行真机覆盖安装验收。

## 边界

本次不改图标效果适配方式，不把素材像素检查、构建验签或渠道可用称为真机桌面显示及覆盖安装数据保留已验证。不创建测试会话。不直接调用独立组合发包入口或重复 dispatch 已运行批次。

## 实际完成记录

2026-10-17：成功批次 `7229da73-9f60-4b14-9388-ca375fad0e18` 完成 `0.3.0 / 3000`，冻结提交 `3502c1fe86534e881fade350b06122f1265e1c16` 与用户指定来源 `4ca6b4d6b728ce3e7f00727b459eafc0b27081ca` 仅有发布清单差异。GitHub 双端构建 `39018994516`、开发检查及全部必要渠道验收成功。

[GitHub Release v0.3.0](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.3.0) 含 APK 和未签名 IPA；Ad Hoc 已签名包发布于 [OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html) 与固定 LAN。GitHub、LAN、OTA 的 HEAD/完整 GET 和构建回执、中文日志、源署名已独立回验；IPA 权限和钥匙串组连续性通过。没有执行真机安装或桌面显示验收。详情见 [发布凭证摘要](evidence/2026-10-17-apple-intelligence-030-release.json)。
