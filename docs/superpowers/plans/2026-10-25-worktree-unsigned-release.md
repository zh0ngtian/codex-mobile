# worktree映射联合交付与停止OTA实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 发布worktree归属修复并部署配套网关；从本次起停止OTA、本机iOS构建签名及已签名IPA渠道更新，iOS只发布GitHub unsigned IPA和既有软件源。

**Architecture:** 复用现役协调器，使用新unsigned客户端目标`codex-mobile-github-release`与现役网关目标两个任务，ready同一固定来源SHA，共享main写锁。客户端引入`mobile-unsigned`范围，阶段为`main → build → apk → source → verify`；仓库分发策略阻止现行源码使用旧配置启动本机签名或OTA，历史冻结提交及其凭证保持原样。

**Tech Stack:** Python unittest、现役releasectl 0.1.7、GitHub Actions、Node/Vitest、launchd。

## 用户运行中更新范围：Android也停止局域网分发

### 0.3.38最终只读回验失败及关联修复

GitHub-only批次`c2997b88-4cc4-4298-b292-6cd3b4a3d70b`已成功发布0.3.38和同步软件源，但最终verify完整下载GitHub附件遇到`curl (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL`，适配器未将这一具体连接中断归入只读暂时故障，批次已failed。保留该失败现场与0.3.38包，不resume或修改冻结提交。关联修复任务`sidebar-worktree-github-only-read-repair-20261025`继承原任务和来源，沿用同一GitHub-only目标与四阶段，使用更高版本完成正式凭证。

- [ ] 在`tests/ci/test_release_read_recovery.py`先用实际错误文本写RED：curl35且明确SSL_ERROR_SYSCALL连接中断可返回TransientReadError；普通curl35、证书/配置/权限问题仍永久失败，写命令不因该错误可重试。
- [ ] 在`transient_read_error`的原有永久错误优先判断之后，最小增加curl35的窄条件；不添加`-k`、不绕过TLS校验，不扩大到所有SSL/TLS错误。依据curl官方错误码文档，35需结合诊断区分原因，不能整体放行。
- [ ] 完成TDD GREEN、全部Python、相关构建契约及typecheck门禁，规格/质量复核，推送修复SHA并ready已登记关联任务。失败批次和原版本均不可变，新批次仍只GitHub双端与iOS软件源。
- [ ] 成功后独立完成全包及渠道回验，公开凭证同时记录用户撤销LAN的旧批次与本次TLS诊断修复谱系，不把早前已发布附件当作完整成功凭证。

用户随后要求“关闭Android在局域网的发布服务，只保留GitHub Release”。此要求覆盖前述固定APK交付步骤；iOS unsigned IPA与既有软件源继续。局域网服务已停止并disable，旧客户端批次`d9ecccee-0825-4e20-94a3-6c3f16ff559d`的本机build等待进程已终止，由协调器保留原冻结合同及失败记录；其GitHub构建不取消，不执行旧LAN阶段。网关成功批次`8574742b-24e0-4a42-8150-77d543498280`及真实项目映射回验保留有效。

- [ ] 新增`mobile-github-only`与新项目`codex-mobile-github-only`（target同名，environment `github-only`），复用现役协调器与main锁；阶段精确`main/build/source/verify`。在分发策略增加`androidDistribution=github-only`，新策略拒绝旧含LAN范围，历史无策略／旧策略夹具保持原合同。
- [ ] TDD：先证明prepare在LAN服务关闭时仍可完成版本分配、三个入口拒绝apk/ipa/ota/sign/iosbuild/gateway，verify不访问LAN、只核对GitHub正式双端与iOS软件源。运行实际RED后最小实现；GitHub manifest门禁新增精确项目/target/env合同及对应失败测试。
- [ ] 新prepare只读GitHub全部Release、仓库下限和保留版本预留，不依赖任何LAN/签名/HTTPS；新verify明确`distribution=github-only`、`lanApkPublished=false`及旧iOS渠道未发布，保存独立凭证；不改变客户端更新交互。
- [ ] 更新AGENTS、README、文档索引、发布协调、交互约定的现行规则与验收点。Android新版本从GitHub手动下载，关闭LAN后不再承诺旧客户端的LAN更新检查可用；不自行新增GitHub自动更新功能。保留旧包/清单及旧冻结合同，不删除历史资料。
- [ ] 完成四项真实门禁、规格/质量审查、推送固定来源后ready新项目。此次后续修改只影响发布策略、测试与文档，不重复部署已成功网关；通过server/bin源码不变与祖先关系证明配套运行代码已部署。
- [ ] 新客户端批次成功后独立下载GitHub APK/unsigned IPA，核对iOS普通/legacy软件源、正式/开发CI及来源，确认8765不监听且launchd禁用，LAN清单/包文件未被本轮更新，最后同步公开凭证与main文档。

基线：远端main `30db425fb265902b174fc80515e025a80c85b780`；主工作区本地main `7772b28f5e716d8e5e3759fb1e84a089158502ec`，已有暂存改动不动。本任务复用隔离工作区`/Users/zhongtian/.codex/worktrees/sidebar-worktree-mapping/codex-mobile`。

## Task 1：分发策略、适配器与回归

文件：`release/distribution-policy.json`、`release/coordinator.unsigned.example.json`、`scripts/codex_mobile_release_adapter.py`、`tests/ci/test_unsigned_release_adapter.py`及受影响的构建契约测试。

- [x] 先增加失败测试：新范围prepare不读取签名配置、证书或HTTPS OTA，不执行签名预检；版本仍高于GitHub、固定LAN历史清单、仓库下限及版本预留。新版策略拒绝旧签名范围；unsigned范围的check/execute/run入口拒绝`iosbuild/sign/ota/ipa/gateway`。
- [x] 执行`python3 -B -m unittest discover -s tests/ci -p 'test_unsigned_release_adapter.py' -v`，保存预期RED。
- [x] 实现最小新范围与策略：`self.unsigned_only = self.options['kind'] == 'mobile-unsigned'`，`self.mobile`包含新范围；模板阶段精确为`['main','build','apk','source','verify']`。策略文件为`{"schemaVersion":1,"iosDistribution":"unsigned-only"}`，存在该策略时拒绝旧`mobile/mobile-ota`范围；无策略的历史夹具及冻结工作区继续按原合同验证。
- [x] prepare分支仅读取版本来源；`verify`要求main、正式双端CI、固定APK、unsigned软件源及开发CI，独立下载核对GitHub双端附件，写`unsigned-release.json`和明确`distribution=unsigned-only`的成功证据；不生成ota-release，不更新签名IPA。
- [x] 回归覆盖阶段缺失、来源/大小/散列错误和错误阶段配置；运行新增测试与全部Python发布回归确认GREEN，保留RED/GREEN证据。

## Task 2：规则、说明与本次日志

文件：`AGENTS.md`、`README.md`、`docs/release-coordination.md`、`docs/interaction-alignment.md`、`docs/ios-ota-release.md`、`release/notes.md`。

- [x] 就地修订现行交付规则：默认授权客户端发布为GitHub双端、固定APK、unsigned软件源；不再启动本机iOS构建/签名/OTA，不更新固定已签名IPA，不要求提供旧OTA链接。旧OTA文档明确为历史参考，不删旧渠道与签名材料。
- [x] 本次中文用户变化日志只写实际未发布功能：worktree会话归原项目、统一分页及搜索；根据现役上版冻结提交核实是否有其他客户端用户变化再写，不把分发模板放进日志。
- [x] 交互约定增加新分发现行规则、验收点、变更记录，状态先标记待真实批次验收。
- [x] 规格审查通过后进行质量审查；任何问题修复后复审，再继续。

## Task 3：准备、发布、部署

- [x] 本地门禁并保存真实退出码：全部Python CI、已安装协调器核心恢复测试、`npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`、`npm run typecheck`。重用上一轮已通过的worktree功能200项及页面流程证据，只有整合修改影响相关功能时补跑对应范围。
- [x] 现役协调器禁止修改含历史失败批次的旧配置，故不改写原LAN/OTA项目；登记同服务新`codex-mobile-github-release`目标，阶段使用unsigned模板、不含ios_config，继续共用main锁并保留既有路径/凭据。旧LAN未ready任务已withdrawn。通过`releasectl project --config <新客户端配置>`登记，不重装服务。
- [ ] 提交中文Conventional Commit，推送来源分支，验证远端SHA。生成含四项真实passed证据的validation，两个任务ready同一SHA，由协调器整合最新main、回归、冻结并推进main。
- [ ] 使用有界wait/status跟进，不修改冻结工作区。失败只按真实原因创建关联修复，不覆写失败批次或旧渠道。
- [ ] 客户端成功核对GitHub APK/unsigned IPA、固定APK清单/HEAD/完整GET、普通及legacy软件源版本/大小/散列/中文日志/原署名；网关核对成功receipt、进程、监听、认证健康及真实项目映射。确认本轮没有iosbuild/sign/ota/ipa阶段，旧签名/OTA清单不变。

## Task 4：交付与收尾

- [ ] 生成脱敏公共凭证，文档更新实际两个批次、版本、冻结SHA、包元数据和已验收范围，不把真机安装/用户体验标为已验证。
- [ ] 文档收尾经规格与质量审查后，在共享main租约下核对最新main并推送；主工作区原有暂存内容逐字节不变。
- [ ] 停止heartbeat，保存长期验证证据。最终提供GitHub Release、固定APK和unsigned IPA实际下载链接、版本、大小、SHA-256，说明网关部署成功及今后停止OTA和签名。
