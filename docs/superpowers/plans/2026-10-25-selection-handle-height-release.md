# iOS 选择杆高度修复默认双端发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本次已按子代理执行方式开展：发布准备实现后，先独立规格审查，再独立质量审查；主代理负责门禁、heartbeat、固定来源推送及协调器操作。用户已明确授权发布上一轮选择杆修复，未限定平台，依仓库规则执行默认双端客户端发布，无需再次选择执行方式。正式 main 整合、版本分配、冻结、构建、签名与渠道写入仅由现役 releasectl 协调入口执行。

**Goal:** 将已完成源码与模拟器验证的 iOS 选择杆高度修复及上一正式版本之后的实际客户端变化发布到双端固定渠道，以同一批次成功 receipt 和独立完整下载回验作为交付依据。

**Architecture:** 复用 `codex-mobile-lan-production`，任务为 `selection-handle-height-release-20261025`，独立工作区为 `selection-handle-release/codex-mobile`，分支为 `release/selection-handle-height-20261025`。发布准备修改基线为工作区 HEAD 与远端 main `fd1e60215bcda31c3b7954829a9ab7545e3a7d25`；本地 main 仍为 `7772b28f5e716d8e5e3759fb1e84a089158502ec`，主工作区既有暂存改动保持不动。只发布客户端，不部署生产网关；本轮准备只修改文档和更新日志，复用既有运行代码与已保留的 TDD 证据。

**Tech Stack:** releasectl、Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、既有 Ad Hoc 签名、HTTPS OTA、固定 LAN 渠道与 GitHub unsigned IPA 软件源。

**收尾基线与边界：** 正式批次成功后，纯文档收尾以工作区 HEAD 与远端 main `ec4e1582394bbd6cefa3af957cf09a86d30bcf48` 为开始修改基线；只更新 README、文档索引、交互约定、本计划及公共白名单凭证。主工作区既有10项暂存仍保留，最终回执独立规格／质量审查、共享锁下文档推送和清理由主代理完成。

---

## 文件与职责

| 文件或证据 | 职责与修改范围 |
| --- | --- |
| `release/notes.md` | 本批各渠道共用的中文用户变化日志；覆盖上一正式0.3.35之后的实际客户端变化 |
| `README.md`、`docs/README.md` | 正式成功后更新现役版本及四项客户端变化，保留0.3.35历史语义 |
| `docs/interaction-alignment.md` | 准备阶段记录授权与待验边界；成功后就地更新本轮四项现行状态，保留源码验收时点与无关未发布功能的状态 |
| 本计划 | 发布准备、审查、四门禁、协调器正式发布、独立回验与纯文档收尾的执行清单 |
| `docs/superpowers/plans/evidence/2026-10-25-selection-handle-height-release.json` | 原字节保存经白名单筛选的公共渠道凭证 |
| `.mobile-build/selection-height-20261025/`（长期主工作区） | 上一轮源码 TDD RED／GREEN、xcresult、截图、源码散列与 `source-delivery.json`，只读复用 |
| `~/Library/Application Support/ReleaseCoordinator/validations/selection-handle-height-20261025/` | 本轮私有断言、门禁、预检、审查及渠道回验材料，不加入 Git |

正式冻结清单、版本和 main 的推进归协调器；准备实现者不得单独 ready、正式发包、修改版本或推进 main。成功发布后的公共白名单凭证及现役文档更新由主代理在纯文档收尾阶段完成。

## 任务一：核对授权、基线与已有源码证据

- [x] 主代理登记上述默认双端目标任务并维护 heartbeat，准备工作使用独立 worktree；主工作区暂存内容不参与本次修改。
- [x] 阅读 `AGENTS.md`、`docs/commit-conventions.md`、`docs/release-coordination.md` 与现行交互约定，记录发布准备基线 `fd1e60215bcda31c3b7954829a9ab7545e3a7d25`。
- [x] 核对既有 `validation.json`、`source-delivery.json` 和失败日志；原始源码的选择端点曾为41／33／49pt，期望25pt，失败原因为段后留白进入选择杆，而非测试启动错误。最终六项 GREEN 为 `6 passed, 0 failed, 0 skipped`，不重改已验收的运行代码。
- [x] 按既有 `validation.json` 逐一计算当前三个文件的 SHA-256，确认 `NativeSelectableText.swift`、`AgentSelectionQuotesFixture.swift`、`MarkdownLayoutUITests.swift` 与上一轮已验证源码一致；复核最终截图中蓝色选区、贴合文字的选择杆及引用／复制菜单。

既有功能证据位于长期主工作区 `.mobile-build/selection-height-20261025/`：`endpoints-reproduce.xcresult` 及其日志保留端点 RED，`final.xcresult` 保留最终六项 GREEN，`selection-handles-fixed.png` 保留视觉结果。上一轮开发 main 基线为 `7772b28f5e716d8e5e3759fb1e84a089158502ec`，随后已整合并验证 `00a8da95a3e26a699ab5099950d7ced2385041e0` 和 `870c14b27e503b1575276da68aec63779fc278ab`；源码交付提交及远端 main 均为 `fd1e60215bcda31c3b7954829a9ab7545e3a7d25`。模拟器范围为 iPhone 17 Pro／iOS27、正常字号、竖屏；离线夹具没有创建真实会话。真机覆盖安装、数据保留与真机视觉仍待现场验收。

## 任务二：先 RED、再更新中文日志并 GREEN

**修改：** `release/notes.md`、`docs/interaction-alignment.md` 与本计划。此任务不构建客户端。

- [x] 在修改旧日志前执行同一真实断言，观察退出1，缺少“选择杆、段后、复制、引用”；保存 `notes-red.log` 和 `notes-red.json`。

  ```python
  from pathlib import Path
  notes = Path('release/notes.md').read_text()
  required = ('选择杆', '段后', '复制', '引用')
  missing = [word for word in required if word not in notes]
  assert not missing, '中文日志缺少 ' + '、'.join(missing)
  ```

  本轮实际执行的私有检查器为 `notes-check.py`；它保存断言结果、真实退出码、更新日志正文散列与时间。RED 命令为：

  ```bash
  python3 "$HOME/Library/Application Support/ReleaseCoordinator/validations/selection-handle-height-20261025/notes-check.py" red
  ```

- [x] 阅读 `44bdf78`、`00a8da9`、`870c14b` 的实际客户端差异，将日志替换为以下四条，不加入构建、冻结、签名或分发模板：

  ```text
  - 修复 iOS 列表文字选择杆过长，排除段后留白并保留原有间距、复制和引用操作。
  - 修复自动命名触发过早及已保存标题未同步当前页面的问题，无需退出会话即可更新名称。
  - “用量与额度”新增“最近请求上传”和“本轮累计上传”，支持显示网关提供的模型请求载荷字节数。
  - 已有后续最终回答的中途结构化提问收进“执行过程”，展开后保留问题与选项，待回答问题继续可见。
  ```

  上传计量提交同时包含服务端源码，本次授权只覆盖客户端发布；新增界面字段依赖网关提供统计值，不把本轮发布描述成上传计量后端已部署。现行无数据占位仍为“暂无数据”。

- [x] 使用未修改的检查器执行 GREEN，实际退出0，保存 `notes-green.log` 与 `notes-green.json`：

  ```bash
  python3 "$HOME/Library/Application Support/ReleaseCoordinator/validations/selection-handle-height-20261025/notes-check.py" green
  ```

- [x] 交互约定追加本次默认双端发布已授权／准备中记录，保留现役0.3.35与源码已验证、渠道待验的边界，不部署或宣称部署网关。
- [x] 完成文字、链接和差异自查，确认本次仅修改上述三个文件：

  ```bash
  git diff --check
  git diff --name-only
  ```

## 任务三：四项门禁、只读预检与独立审查

主代理已执行并保存真实命令、退出码、日志及散列；准备实现者读取对应 JSON 与日志末尾复核结果，未重复运行。上一轮功能六项 GREEN 不代替发布门禁。

- [x] `adapter-regression`：在本发布工作区执行，217项通过、退出0。

  ```bash
  /opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s tests/ci -p 'test_*.py'
  ```

- [x] `coordinator-recovery`：在现役协调器源码工作区执行，59项通过、退出0。

  ```bash
  cd /Users/zhongtian/WorkSpace/release-coordinator
  /opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s tests -p 'test_*.py'
  ```

- [x] `build-contract`：在本发布工作区执行，21文件144项通过、退出0。

  ```bash
  npm test -- tests/ci --maxWorkers=2 --testTimeout=60000
  ```

- [x] `typecheck`：在本发布工作区执行，实际退出0。

  ```bash
  npm run typecheck
  ```

- [x] 执行既有 iOS 组合入口的只读 `--plan` 预检，实际退出0，核对授权身份、兼容基准及签名材料；不从该入口独立正式发包。

  ```bash
  npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --notes '修复列表文字选择杆过长' --plan
  ```

- [x] 只读读取现役固定渠道与软件源基线，APK／IPA及unsigned软件源均为0.3.35；读取最新版 [SignOs 软件源说明](https://github.com/zh0ngtian/SignOs/blob/main/distribution/source-aggregator/README.md)，存入私有证据 `signos-source-readme.md`。动态读取的 GitHub 账号与现有软件源署名同为 `zh0ngtian`；正式同步仍以软件源当时的完整署名为基准，已有则保留、缺少则追加，不硬编码或覆盖旧署名。
- [x] 执行客户端相关回归5文件135项通过；只读渠道审计工具仅调整任务、功能来源 SHA 与仓库绑定，19项自测通过。这些本地自测不代表正式渠道已验收。

四门禁对应私有目录的 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck` 同名 JSON／log；`checks-complete.json` 汇总通过结果。首轮 adapter 回归与 `npm ci` 并发，在依赖未就绪时因缺少 jsdom 导致两项失败，原始 `adapter-regression-before-dependencies.*` 保留；依赖安装完成后，同一未改产品代码完整重跑217项通过，不放宽断言。`development-evidence-recheck.json` 已核对三份修复源码散列、最终六项 GREEN 与截图一致。上述结果在独立审查前完成，仍不能据此标为已发布。

- [x] 对本次准备变更及所复用功能来源完成独立规格审查，再完成独立质量审查；均passed，无未解决实质问题。私有记录为 `spec-review.json`、`quality-review.json`。
- [x] 按中文 Conventional Commits 提交准备文件；主代理统一推送固定来源 `a21092efa35521cca4690d51f88755297afb5106`，`validation.json` 绑定该 SHA、四个真实 `passed` 门禁及证据；来源推送前的远端 main 核对已完成。

## 任务四：固定来源 ready 与协调器正式发布

- [x] 主代理完成最终来源核对后，在发布分支执行 ready，绑定来源 `a21092efa35521cca4690d51f88755297afb5106`；准备实现者未调用此命令。

  ```bash
  release_source_sha=$(git rev-parse HEAD)
  "$HOME/.local/bin/releasectl" ready --task selection-handle-height-release-20261025 --sha "$release_source_sha" --validation "$HOME/Library/Application Support/ReleaseCoordinator/validations/selection-handle-height-20261025/validation.json"
  "$HOME/.local/bin/releasectl" wait --task selection-handle-height-release-20261025 --timeout 45
  "$HOME/.local/bin/releasectl" status --task selection-handle-height-release-20261025
  ```

- [x] 由协调器在 `codex-mobile-main-production` 共享锁下整合 main、分配0.3.36（3036）、冻结并推送 `ec4e1582394bbd6cefa3af957cf09a86d30bcf48`；同一正常批次完成正式 CI、设备构建、Ad Hoc 签名、HTTPS OTA、固定 LAN APK／已签名 IPA、GitHub 双端 Release 与 unsigned 软件源全部必要阶段。
- [x] 保留并初步核对同一成功批次 receipt：任务与正常批次 `7a86258c-6c83-4162-b9d2-0cd7bc5d8b43` 均complete，无恢复子批次；冻结 SHA 包含发布来源及选择杆功能提交，全部必要阶段成功，版本、构建号、正式和开发 CI 来源一致。最终独立回执规格／质量审查仍按任务五末项待完成。

恢复规则：暂时只读失败继续原冻结批次；永久失败保留现场，仅登记显式关联最新失败叶的修复任务，不 resume、重写或重新分配失败批次。正式渠道和 main 的写入始终通过协调入口，不使用单独上传或手工版本替代。

## 任务五：独立完整下载回验

- [x] 核对固定 Android JSON `http://192.168.123.79:8765/channels/codex-mobile/latest.json`，再对[固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)执行 HEAD 和完整 GET；核对本次实际版本、文件大小、SHA-256 及来源与同一成功 receipt 一致。
- [x] 核对固定 iOS JSON `http://192.168.123.79:8765/channels/codex-mobile/latest-ios.json`，再对[固定已签名 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)执行 HEAD 和完整 GET；核对与 APK 的统一版本、大小、SHA-256。下载后的 IPA 独立验签，并与真实兼容基准核对 Bundle ID、Team、application-identifier、完整权限和钥匙串组连续性。
- [x] 使用项目 CA 核对[固定 HTTPS OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、同前缀的 `latest-ios.json`、manifest、版本化已签名 IPA 的 HEAD 与完整 GET，确认与 LAN 已签名包一致；保留 `ota-release.json`。不把验签或模拟器验证当作真机覆盖安装和数据保留已验证。
- [x] 独立完整下载 GitHub 本次 APK 与 `CodexMobile-*-unsigned.ipa`，核对 Release tag、冻结来源、版本／构建号、大小和 SHA-256。unsigned IPA 不覆盖 HTTPS OTA 或固定 LAN 的已签名 IPA。
- [x] 核对[普通软件源](https://signos-source-aggregator.305301890.workers.dev/sources/yao.json)及其现役 legacy 视图的本次 unsigned 版本、构建号、GitHub URL、大小和散列；核对真实同步结果、动态 GitHub 账号署名追加／保留，以及原开发者和展示信息仍完整。已签名 IPA 不上传或订阅到软件源。
- [x] 逐条核对 GitHub Release、LAN、OTA 与软件源实际展示的中文更新日志，必须等于本批冻结的四条用户变化；没有版本号、SHA、构建分发模板，也没有网关已部署或上传计量后端已上线的错误承诺。
- [x] 对成功 receipt、实际下载、渠道审计和公开白名单凭证先做独立规格审查，再做独立质量审查；记录未解决项，全部实质问题关闭后才完成最终交付。


## 任务六：纯文档收尾与固定链接交付

- [x] 以实际成功 receipt 和237项独立回验更新本计划、交互约定、现役 README／文档索引及公共白名单凭证；公共 JSON 与私有白名单输出原字节一致，只公开版本、来源、必要渠道与验证摘要，不提交私有原始 receipt、签名材料、UDID、认证信息或私有日志。最终独立规格与质量审查均通过，无未解决问题；纯文档收尾按共享main互斥提交推送。
- [x] 在共享 main 写入互斥下核对最新远端 main；纯文档收尾只检查文字、JSON、链接及 `git diff --check`，按中文提交规范提交推送，不重复构建、签名、更新渠道或部署网关。停止本任务 heartbeat；已验证离线夹具无需归档真实会话，新建真实测试会话则在验证完成后及时归档。
- [x] 交付回复正文展示可点击的[固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)及[固定已签名 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)，附本次实际统一版本、两个包各自的字节大小和完整 SHA-256，并明确 IPA 为 Ad Hoc 已签名。保留真机覆盖安装、数据保留和真机视觉待现场验收边界。

## 当前状态

正式双端发布成功，237项独立渠道回验passed；最终回执规格与质量审查均通过，质量19项检查通过，无未解决问题。现役文档、公共凭证及本计划已同步；纯文档收尾按共享main互斥提交推送，不再次构建或更新渠道。任务heartbeat已停止，发布工作区在交付收尾时归档。选择杆六项模拟器GREEN、中文日志RED／GREEN、四门禁、客户端5文件135项回归、只读预检与审计工具19项自测均保留原证据；本轮纯文档收尾只检查文字、JSON、链接及差异，不重跑客户端构建或发布。

| 项目 | 实际结果 |
| --- | --- |
| 任务／目标 | `selection-handle-height-release-20261025`／`codex-mobile-lan-production` |
| 版本／构建号 | 0.3.36／3036 |
| 发布来源 | `a21092efa35521cca4690d51f88755297afb5106` |
| 冻结提交 | `ec4e1582394bbd6cefa3af957cf09a86d30bcf48` |
| 正常批次 | `7a86258c-6c83-4162-b9d2-0cd7bc5d8b43`，任务与批次均complete |
| 成功receipt SHA-256 | `6bc9c762af481283bf9ab186e8e863561d2afd6ea0b8692a9e0cf73654a4d902` |
| 正式CI | [40162723132](https://github.com/zh0ngtian/codex-mobile/actions/runs/40162723132)，attempt 1、success |
| 开发CI | [40162722953](https://github.com/zh0ngtian/codex-mobile/actions/runs/40162722953)，attempt 1、success，同一冻结提交 |
| GitHub Release | [v0.3.36](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.3.36) |
| 独立渠道回验 | 237项passed，项目CA验证通过；完整审计SHA-256为 `52e27fab82827ee8ef20cc53a46b012906ce57df538497e4b2319a615c149817` |
| 公共白名单凭证 | [本次公共JSON](evidence/2026-10-25-selection-handle-height-release.json)，原字节SHA-256为 `1c0a2ae58718574b3e6ddb345d694cc43771fb5f94c450152e0c0698568dad83` |

固定安装入口为[HTTPS OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)。本次实际包元数据如下，固定链接后续会随新版本覆盖：

| 安装包 | 版本（构建号） | 字节大小 | SHA-256 |
| --- | --- | --- | --- |
| [固定APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) | 0.3.36（3036） | 4753707 | `40716e38326ecc4badd2d941780f2d60227eeb9a1af24998f0538038b42971e5` |
| [固定IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)，Ad Hoc已签名 | 0.3.36（3036） | 5030316 | `7f308a89751831079afb4b7a3517138a15fc95fe2a92472dd9873dfb3fff5e5e` |

OTA版本化包与上述LAN已签名IPA大小及散列一致。软件源0.3.36（3036）保持动态读取的 `zh0ngtian` 署名，订阅GitHub unsigned IPA，大小5023893字节、SHA-256为 `36aa61a342c56e8b991bdeac086eef368594c50b6e1d96dbabbc509fd0ed8aae`；未签名包未覆盖LAN或OTA已签名包。

本轮客户端发布四项用户变化为选择杆高度、自动命名就绪与当前页名称同步、上传计量显示字段、中途结构化提问收进执行过程。本轮没有部署生产网关，上传计量后端仍未部署；网关不提供统计时两个字段继续显示“暂无数据”。真机覆盖安装、数据保留、真机视觉及真实Bark送达均未验证，模拟器和构建验签不扩展为这些结论。公共凭证只保留白名单摘要，原始receipt、完整审计、签名配置、UDID和日志继续保存在仓库外私有目录。
