# Codex Mobile 发布协调说明

通用的开发与发布分离、合批条件、等待窗口、冻结、避免抢占、失败恢复和完成判据，统一维护在当前生效的 canonical 全局 `AGENTS.md` 的“多任务协调、合批构建与发布”中。本说明只补充本项目的目标、验证、入口现状和具体改造项；项目约束见 [仓库规则](../AGENTS.md)。

## 适用目标与交付合同

| 变更范围 | 本项目需要的交付 | 本项目验证与限制 |
| --- | --- | --- |
| 客户端运行代码、客户端引用的共用模块、原生桥接或影响客户端产物的构建配置 | 同批统一版本的 GitHub APK/unsigned IPA Release、固定 LAN APK/Ad Hoc 已签名 IPA、HTTPS OTA；核对软件源 unsigned IPA 同步 | 任务本地验证及整合后的必要检查；CI 构建契约与安装包校验；固定清单、HEAD、完整 GET 的版本、大小和 SHA-256；iOS 签名与升级身份连续性 |
| 仅服务端 | 必要验证、`npm run build:server`、网关部署和部署验收 | 不触发客户端 Web、APK 或 IPA 构建发布；与客户端发布目标不同，不能仅因同仓库就合为同一发布目标 |
| 仅文档、仓库规则、测试或不影响客户端产物的脚本，且不涉及构建或发布 | 相应验证、提交与推送 | 直接完成，不启动合批发布或客户端构建；脚本若影响服务端部署则仍按实际影响完成验证 |

本项目版本继续使用 `major.minor.patch`，Android `versionCode` 与 iOS 构建号沿用 `major * 1000000 + minor * 1000 + patch`；`minor`、`patch` 小于 1000，构建号为正且不超过 2100000000。客户端批次版本必须高于 Android、iOS 固定 LAN 和 HTTPS OTA 当前版本，同时满足全部 GitHub Release 标签和 `mobile-version-floor.json` 的版本下限。CI 无法读取 LAN，协调入口必须对账后传入统一版本或同步仓库下限，不能让 CI 与本机各自分配。

现役渠道与命令继续沿用 [文档索引](README.md#当前发布入口)、[移动端构建说明](../mobile/README.md)和 [iOS OTA 发布说明](ios-ota-release.md)。软件源仍只同步 GitHub Release 的 unsigned IPA；Ad Hoc 包只发 HTTPS OTA 与固定 LAN。签名材料、本机发布配置、Bundle ID、Team、application-identifier、钥匙串组及真机验收边界均不变。服务端部署沿用现有网关方式，不新增分发渠道。

## 入口现状（2026-10-12 静态核对）

**规则已更新，统一协调机制尚未实现。** 以下结果来自仓库工作流及脚本检查，不代表实际线上版本、运行中的 CI 或真机状态已经验收。本次未改变 CI/脚本，也未启动构建、签名、渠道发布或网关部署。

| 入口 | 已有支持 | 未覆盖的协调要求 |
| --- | --- | --- |
| `.github/workflows/build-mobile.yml` | 客户端相关 main 推送或手动触发；同次 run 分配双端版本；两端契约测试、构建与校验全部成功后才创建同一 Release；下载当前 run 的 artifacts 并校验散列；`cancel-in-progress: false` | 无任务登记、合批窗口、冻结批次输入；`mobile/**` 会误匹配 `mobile/README.md` 等纯文档；并发组按 `github.ref` 分开；缺少 `queue: max`，等待中的 run 仍可能被新 run 替换；不覆盖本机签名、LAN/OTA、软件源核对或网关部署 |
| `scripts/resolve-mobile-version.mjs` | 读取全部 Release 标签及仓库下限；统一计算版本与构建号；显式版本必须更高 | 无 LAN/OTA 对账、批次版本预留及失败批次状态；构建未创建 Release 时，其版本分配不会自动形成持久预留 |
| `scripts/build-mobile.mjs` | 固定容器 SHA，复用 recipe，生成大小、SHA-256 与 `*-build.json`；CI `sourceCommit` 取 `GITHUB_SHA` | 不读取批次清单、不校验工作区与冻结 SHA 一致；本地未设置 `GITHUB_SHA` 时 `sourceCommit` 为 null；无批次/run/attempt 统一凭证绑定 |
| `scripts/release-ios.py` / `npm run ios:release` | 检查 LAN/OTA 版本和签名身份；设备构建、Ad Hoc 签名、HTTPS 与 LAN 回验；保存已签名 IPA 和 `ota-release.json` | 仍能单独分配版本、独立构建发布；无从版本分配贯穿最终回验的批次锁、冻结 SHA 校验、任务映射和 CI run 绑定；成功凭证不是双端/网关统一凭证；中途失败不生成完整协调诊断 |
| `scripts/ios_ota.py` | OTA 根目录 `.publish.lock` 使用 `fcntl.flock`；阶段发布和激活有升级检查、不可变版本目录与原子 `current` 切换；HTTPS 回验 | 锁只覆盖各次 OTA 文件操作，不覆盖构建、签名、LAN 或整批验收；无负责人、心跳、租约与跨机器协调记录；进程退出释放锁不能替代中断接管对账 |
| 既有 `apk-server.py publish-channel codex-mobile` | 校验包，计算大小/散列，保存渠道更新历史，分别替换固定包与清单 | 无整批互斥锁、单调版本强制检查、冻结提交校验或双端事务；包与清单分别 `os.replace` 不等于双端渠道原子发布；固定地址覆盖不等于保留完整历史安装包 |
| 网关部署 | 项目规则要求验证、服务端构建与部署；现有安装和运行入口保留 | 仓库未提供与移动端发布共用的任务队列、部署锁、冻结提交/部署状态及最终凭证协调入口 |

GitHub Actions 的多批排队要求依据 [GitHub 官方并发文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)：后续需要增加 `queue: max` 并保留 `cancel-in-progress: false`。队列有容量限制，且不能代替批次整合；调度状态必须由协调入口对账。

## 具体待改造项

以下全部为 **pending**，本次仅登记，不表示已经存在对应 CLI、状态目录或服务。

1. **唯一协调入口与共享任务队列。** 为 Codex Mobile 客户端固定渠道和网关部署分别标识发布目标/环境，由同一协调控制面处理登记、整合、冻结、启动、查询、恢复和验收。任务记录包含任务 ID、分支/worktree、确定的完整 SHA、验证命令及结果/证据、目标、负责人、活跃状态和独立/紧急交付要求。开发任务不直接运行正式发布命令或推进需要发布的 main；无构建发布的任务保留直接完成路径。
2. **完整周期的互斥锁。** 覆盖提交整合与 main 推进、版本预留、CI、本机签名、APK/IPA 固定渠道、OTA、软件源版本核对及必要部署验收；记录锁持有者、心跳、租约和接管历史，阻止过期持有者继续写渠道。单机 worktree 共用同一协调状态；多机器改用所有参与方可访问且支持原子互斥的控制面，不能各用自己的本地文件锁。
3. **合批与冻结状态机。** 按全局规则实现等待窗口，依据活跃相关任务和收尾验证状态判断是否延长。整合任务提交，记录冲突解决及提交映射并复验。冻结任务、任务 SHA、最终整合 SHA、统一版本/构建号、发布目标及检查证据；冻结后任务另入下一批。冻结记录不得被正在构建期间的新任务改写。
4. **CI 触发与排队。** 在 `build-mobile.yml` 增加 `queue: max`，并以同一应用/发布环境统一并发组，避免其他 ref 的手动运行绕过串行控制。将触发方式接入协调入口：冻结后只触发该批正式构建，main 自动触发与手动触发须去重或调整；checkout、版本 job、Release target 必须绑定冻结 SHA/版本。校验批次输入，拒绝未登记正式发布；补齐 `mobile/**` 内纯文档、测试等不影响客户端产物变更的路径/影响范围排除，保留现有服务端排除与必要构建契约检查。
5. **产物来源与统一版本门禁。** 为 `build-mobile.mjs`、`release-ios.py` 增加冻结 SHA/工作区一致性校验与批次、run/attempt、版本及散列记录；本地真实来源不能依赖任意环境变量。协调入口一次编排现有双端 CI 和本机 iOS 设备构建/签名，各目标使用同一冻结提交，参与任务不分别构建或签名。只有来源与本批一致的 APK、unsigned IPA、Ad Hoc IPA 才能进入各自现有渠道，禁止借用其他提交的成功 run。
6. **渠道与网关接入。** 用统一锁约束既有 APK 发布器、iOS OTA/LAN 发布入口及网关部署；保留现有身份校验、不可变 OTA 版本目录、版本规则和全部回验。补充 LAN 发布的单调版本门禁、包/清单一致性检查及部分成功状态记录；不另换渠道，不把 OTA 局部锁误称为端到端发布锁。
7. **失败与中断恢复。** 持久保存批次、阶段、版本预留、CI run URL/ID/attempt、失败日志、已成功渠道和部署标记。接管先查询远端实际 run、Release、LAN/OTA 版本与散列及网关状态，防止重复签名/发包/部署。OTA 已有版本目录不能盲目重发；按现有不可覆盖与版本递增规则恢复，必要时记录与原失败批次关联的更高修复版本和新来源 SHA。无关任务不能覆盖失败批次状态。
8. **共同发布凭证与完成核对。** 将最终 SHA、任务提交映射/改动包含证据、版本/构建号、CI 结果、各包来源/大小/SHA-256/签名状态、固定下载与 OTA 链接、渠道 HEAD/完整 GET、软件源 unsigned 版本核对、必要网关验收统一保存。各任务读取同一凭证并确认自身改动包含在最终提交；全部必要验收成功才完成。保留历史包、现有构建回执、`ota-release.json` 和验收记录，不能只依赖 14 天 Actions artifacts 留存。

## 落地后的验收重点

机制改造时按项目要求使用计划与 TDD 流程。应验证同目标多任务合批、冲突整合复验、窗口上限、冻结后迟到任务、不同 ref 的发布互斥、多批排队、失败不被抢占、进程/机器中断接管与部分渠道成功恢复；同时验证纯文档/规则及仅服务端改动不会误触发客户端构建。

现有 `tests/ci/mobile-build-workflow.test.ts` 已检查 `cancel-in-progress: false`、构建及产物契约，但没有覆盖上述共享协调机制。规则更新的完成判据仅为文档一致性检查、提交与推送；不能据此宣称合批发布机制验收通过。当前仅文档提交若命中 `mobile/**`，可使用 GitHub 支持的 [跳过 CI 标记](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs) 防止误触发；这不是路径过滤改造已落地，也不能用于跳过客户端发布批次的必要检查。
