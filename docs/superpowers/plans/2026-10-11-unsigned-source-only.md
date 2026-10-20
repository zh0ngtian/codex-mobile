# 软件源仅保留未签名 IPA 实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前独立 worktree 内依次执行；共享软件源状态由当前 Agent 直接处理。

**Goal:** 删除 Codex Mobile 的 Ad Hoc 软件源订阅，后续软件源只同步 unsigned IPA。

**Architecture:** 软件源保留 `zh0ngtian/codex-mobile` 的未签名 GitHub 订阅，删除 `zh0ngtian/ipa-archive` 的 Ad Hoc 订阅，并将未签名条目设为兼容清单默认。本机发布继续负责签名、HTTPS OTA 和固定 LAN IPA，取消签名包软件源待发布提示。

**Tech Stack:** Python unittest、现役 Cloudflare 管理 API、Git。

## 执行步骤

- [x] 修改 `tests/ci/test_ios_release.py` 的现有 plan 与完整发布回归断言：`appSource.status` 预期为 `disabled`，原因包含 `unsigned IPA`。运行 `python3 -m unittest discover -s tests/ci -p test_ios_release.py -v`，确认旧实现因 `pending != disabled` 失败。
- [x] 修改 `scripts/release-ios.py` 的 plan 与成功结果，将两处 `appSource` 改为 `{'status': 'disabled', 'reason': 'Ad Hoc 已签名 IPA 仅发布 HTTPS OTA 和固定 LAN 渠道；软件源只同步 GitHub Release 的 unsigned IPA。', 'instructionsUrl': APP_SOURCE_GUIDE}`；再次运行上述回归，预期全部通过。
- [x] 同步 `AGENTS.md`、`README.md`、`mobile/README.md`、`docs/README.md` 与 `docs/ios-ota-release.md`：软件源只同步未签名包，已签名包仍用于 OTA/LAN，历史记录不改写。
- [x] 读取最新上游软件源文档和管理目录；将导出备份保存在主工作区被忽略的 `.mobile-build/unsigned-source-only/`，文件权限 600。按当前 revision 删除签名订阅；按最新 revision 将 unsigned 条目的 presentation 设置为 `legacyDefault: true`，保留开发者、描述与图标。
- [x] 核对管理目录、公开清单和 `?legacy=1` 清单：仅一个 Codex Mobile 条目且下载 URL 为 `-unsigned.ipa`，签名订阅已不存在，其余订阅配置保持原值。
- [x] 完成 `git diff --check` 和暂存检查，以中文 Conventional Commits 提交、合入 main 并推送，核对远端提交；归档本次 worktree。不修改客户端，不重新构建或发包。

## 验证与结果

- 基线 11 项回归通过；调整预期后，两项测试因 `pending != disabled` 失败；修正脚本后 11 项全部通过。
- Cloudflare 目录 revision 从 62 更新到 64，删除签名订阅 `636583fa-ac79-46ae-9a53-f99100b6eabf`，保留未签名订阅 `bdf9cfa5-6c34-49ca-82fb-31a85ad9e6da` 并设为兼容默认。
- 普通与 `?legacy=1` 清单均仅一个 Codex Mobile 条目，版本 0.2.152、build 2152，所有历史下载均为 unsigned IPA；保留开发者 `zh0ngtian`，其他应用订阅配置与展示信息未变。
- 备份、修改前后目录、两份公开清单与回验凭证位于主工作区 `.mobile-build/unsigned-source-only/`，目录权限 700、文件权限 600。
- 仅修改发布脚本、既有回归、规则与文档，没有修改客户端或重新发包；已有签名包、OTA 与 LAN 固定渠道继续保留。
