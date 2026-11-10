# 网页引用补修发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布网页引用补修，恢复可用来源链接，隐藏无法恢复网址的引用，并部署配套网关。

**Architecture:** 复用现有releasectl、独立worktree、共享main锁和不可变冻结批次。客户端只走GitHub APK／unsigned IPA及既有iOS软件源；网关独立目标ready同一来源SHA。沿用已通过TDD、273项回归和iPhone 17 Pro离线验收的功能实现，不新增运行行为。

**Tech Stack:** Python3.11、releasectl0.1.7、Git、GitHub Actions、Node.js、TypeScript及既有软件源。

---

## 文件与来源

- 发布基线：远端main `3206b7911f36520c332e91d79e4e116bce3e6b62`；包含网关解析修复 `0518f54401422d64af82b5b26c347374b3e9f173`。
- 修改 `release/notes.md`：仅写本版实际用户变化。
- 修改 `docs/interaction-alignment.md`：同步进行中和最终已发布／已部署状态。
- 最终更新 `README.md`、`docs/README.md`、`docs/release-coordination.md`，新增 `docs/superpowers/plans/evidence/2026-11-10-web-citations-hidden-release.json`。
- 私有验证根目录：`~/Library/Application Support/ReleaseCoordinator/validations/web-citations-hidden-20261110`；凭据保持原位，不进入公共文件。

## 任务一：登记、输入与门禁

- [x] 登记客户端 `web-citations-hidden-github-only-20261110` 和网关 `web-citations-hidden-gateway-20261110`，持续heartbeat。
- [x] 输入核对先验证旧日志不符合本次期望，再将 `release/notes.md` 改为：

```text
- 修复部分会话中网页来源链接未显示为可点击编号的问题。
- 无法恢复链接的引用不再显示异常标记，可用来源继续显示连续编号，重复引用沿用编号。
```

- [x] 输入核对转绿：两项修复均为祖先、运行代码与开发验收一致、12个会话73处完整引用均无内部标记、原生验收1通过且0失败。
- [x] 运行私有 `run-gates.py`：Python发布回归、协调器恢复、`npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`、`npm run typecheck`、273项引用范围回归、`npm run build:server`，记录命令、日志、退出码与SHA-256。
- [ ] 提交发布输入，推送固定分支SHA，核对远端并生成named passed checks的validation.json。

## 任务二：授权批次执行

- [ ] 两目标heartbeat进入closing，ready同一已推送SHA与validation.json。
- [ ] 使用 `releasectl wait --task <本计划任务ID> --timeout 45` 等待；由协调器整合main、分配版本、冻结、构建和部署，不独立打包或重启网关。
- [ ] 失败批次保持不可变，真实失败先定位；仅按既有恢复合同登记关联修复，不篡改历史状态或擅自扩大范围。
- [ ] 两目标均取得成功receipt并逐项核对项目、任务、来源、冻结SHA、共享锁、正式／开发CI及实际渠道。

## 任务三：独立交付回验

- [ ] 完整下载本批GitHub APK／unsigned IPA，核对版本、大小、SHA-256与IPA未签名状态；核对软件源版本、同一中文日志、原开发者保留并包含当前gh用户名。
- [ ] 核对生产网关部署标记、实际server/bin摘要、保留的dist／启动配置、launchd进程、监听与认证接口。
- [ ] 生产只读核对同12个会话的来源映射增至54项；客户端同版显示函数隐藏缺失项，73处完整引用均无内部标记；rollout文件字节不变。
- [ ] 核对历史LAN文件未变及8765／8766停用；不发布LAN、签名IPA、HTTPS OTA或固定IPA。
- [ ] 最终公共凭证与文档只记录实际成功结果，明确真机安装与数据保留未验收；共享main锁下提交推送文档，保留主工作区已有暂存修改。
- [ ] 交付GitHub Release、APK、unsigned IPA和软件源链接、版本、两端大小与SHA-256。
