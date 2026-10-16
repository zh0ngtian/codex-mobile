# 原生设备菜单合入 main 并发布 OTA Implementation Plan

> **For agentic workers:** 使用现有独立 worktree、Superpowers TDD 与协调器的不可变批次；本任务直接在当前会话实施。

**Goal:** 把已验证的原生设备菜单与历史原位编辑等修复整合到 main，只发布新的已签名 iOS OTA，并部署 main 中尚未同步的网关行为。

**Architecture:** 在隔离分支先合并最新 `origin/main`、逐项解决冲突，保持原生 UI 和网页/服务端已合入的功能。客户端用现役 `codex-mobile-ios-ota-production`，网关用 `codex-mobile-gateway-production`，两个任务 ready 同一推送 SHA，共享 `codex-mobile-main-production` 锁。两个成功 receipt 都核对后交付。

**Tech Stack:** Git、SwiftUI、TypeScript、Vitest、Swift smoke/XCTest、现有 Python 发布适配器与 releasectl。

## 一、源码整合

- [ ] 核对独立 worktree 干净、当前 `main` 与任务分支的共同祖先，以及两个发布任务已经登记并持续 heartbeat。
- [ ] 合并最新 `origin/main` 到任务分支，解决冲突；保留网页新界面、过程媒体与消息时间、原生设计修复及设备菜单入口。
- [ ] 更新 `release/notes.md`，只列相对现役 iOS 0.2.181 的真实用户变化；提交、推送固定 SHA。

## 二、验证与任务 ready

- [ ] 对冲突处使用已有行为回归（消息顺序/时间、原生投影、菜单到设置入口）；失败先修复再复验。
- [ ] TypeScript 检查、必要 Python/CI 契约测试、Swift 编译及原生菜单点击验收通过；生成可定位的验证文件。
- [ ] 对 OTA 与网关目标分别调用 ready，必须绑定同一已推送源码 SHA；等待冻结整合及目标成功凭证。

## 三、发布回验与收尾

- [ ] 回验 OTA 版本高于现役渠道，签名身份连续；HTTPS OTA、固定 IPA 清单、HEAD、完整 GET、大小及 SHA-256 全部一致。
- [ ] 核对网关冻结 SHA、构建与部署凭证、原服务运行状态；确认两个批次均包含本次源码。
- [ ] 保存版本、散列和 receipt 摘要，提交推送文档；安装页与固定 IPA 链接列入交付回复。真机覆盖安装和数据保留若未执行，明确记录。
