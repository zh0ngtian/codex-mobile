# 后续消息连续过渡双端发布计划

> 执行代理：使用 superpowers:subagent-driven-development 逐项执行，先独立规格审查，再独立质量审查。用户已明确授权默认双端发布，连续完成本计划，无需再次确认执行方式。正式main整合、版本分配、冻结、构建、签名和渠道写入只由现役releasectl执行。

**目标：** 将用户看过录像并确认的非首条消息发送动效发布到双端固定渠道，验收成功凭证与真实下载后交付。

**架构：** 复用已附加隔离worktree及 `codex-mobile-lan-production` 目标，任务 `followup-message-motion-release-20261024`；修改开始main基线与已验收功能来源均为 `86a3c35dfa7cacfa1d0744e624a5ae8412f52b43`。只发布客户端，不部署网关。常规说明准备不修改动效运行代码；独立规格审查发现旧图片预览保留P2后，另纳入图片卡片内的最小修正及针对性UI红绿验证。

**技术栈：** releasectl、Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、既有Ad Hoc签名、HTTPS OTA及unsigned软件源。

## 任务一：发布准备

文件：常规说明准备修改 `release/notes.md`、`docs/interaction-alignment.md`、`docs/plans/2026-10-24-followup-message-motion.md` 与本计划；审查发现的旧图片保留修正另涉及 `OutputImageCard.swift`、必要DEBUG夹具及对应UI测试。私有证据在 `~/Library/Application Support/ReleaseCoordinator/validations/followup-message-motion-20261024/`。

- [x] 登记现役双端任务，核对协调器0.1.7健康，复用干净隔离worktree并启动25秒heartbeat；主工作区已有暂存内容保持不动。
- [x] 先对旧更新日志执行断言，确认缺少“后续”而失败，再替换为以下四条用户可感知变化并验证通过：
  ```python
  from pathlib import Path
  notes = Path('release/notes.md').read_text()
  for text in ['后续', '历史', '附件', '快速确认', '预览', '队列']:
      assert text in notes, text
  ```
  ```text
  - iOS 已有会话的后续消息支持从输入区连续过渡到用户气泡，保留历史消息和会话页头。
  - 文字、图片与文件、多附件及仅附件发送复用相同动效，确认后原位显示。
  - 快速确认不会截断动效或产生重复气泡，连续发送时附件预览按消息正确对应。
  - 后续消息发送失败保留正文与附件并支持返回编辑；结果待确认时防重复，实际入队时由原队列承接。
  ```
- [x] 读取最新版SignOs说明、动态读取当前gh用户名；保存0.3.34现役渠道及unsigned软件源基线，保留完整原开发者署名。
- [x] 保存四项实际门禁日志与散列：`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`（adapter-regression，217项通过）；在release-coordinator工作区执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`（coordinator-recovery，59项通过）；`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`（build-contract，21文件144项通过）；`npm run typecheck`（typecheck，通过）。
- [x] 执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --notes '后续消息动效发布预检' --plan` 只读预检，真实退出0，不独立正式发包。
- [x] 修正前复核同一源码的Swift会话RED/GREEN、24项原生契约、11项不同功能UI和最终4项复验（含重复用例）、18.75秒录像及实际构建证据；当时的 `development-evidence-recheck.json` 核对7份开发日志散列、最终视频散列及运行代码／测试相对 `86a3c35` 未变。该记录仅代表修正前核对；旧图片保留修正后按明确源码差异及新UI GREEN更新证据，不再声称运行代码／测试逐字不变。既有录像复用，不重新录制；新增针对性UI另行验收。
- [x] 发布准备及旧图片保留修正先规格、再质量独立审查，P0至P3均无未解决问题；按中文Conventional Commits提交推送分支，validation.json绑定固定SHA及四项passed门禁。

准备证据已保存至上述私有目录：`notes-red.json`／`notes-red.log`记录旧说明缺少“后续”、真实退出1；`notes-green.json`／`notes-green.log`记录同一断言通过、真实退出0。四项门禁与只读预检各有同名JSON／log，准备时的APK与IPA基线均为0.3.34；此处记录当时的发布准备结果，后续成功receipt见下方发布结果。

### 独立规格审查发现的图片保留P2

下一次发送会撤销上一条消息的临时预览，远端加载慢／失败的旧图片因此退回占位并改变历史高度。先增加真实UI失败用例及显式DEBUG不可达图片回执，保持输入区真实PNG不变；原产品源码RED为1项失败，可访问图片高度约171.7pt降为29.7pt，靛蓝像素变为背景色。最小修正仅在 `OutputImageCard` 内按媒体身份保留已显示预览，优先成功远端图；媒体改变隔离旧图，同媒体任务重启保留图片，取消任务不写回失败。没有新增全局缓存或改动发送／队列业务。

最终源码GREEN完成4项UI（新保留用例、后续混合附件原位交接、后续仅附件、首条附件过渡），0失败，121.6秒；设备范围为iPhone 17 Pro／iOS27、正常字号、竖屏。证据位于 `.mobile-build/followup-message-motion-20261024/preview-retention-{red,green}.xcresult`、对应日志／截图及 `preview-retention-evidence.json`，包含原产品和最终源码散列；首轮GREEN另存 `preview-retention-green-initial.*`。新用例核对正式用户气泡数量、旧图高度和真实截图像素，未放宽消失断言。正常动效路径沿用18.75秒录像；旧 `development-evidence-recheck.json` 仅证明修正前来源，不代替本次差异和新GREEN。没有创建真实网关会话，专用模拟器已关闭。

本地修正、独立规格重审及后续质量审查均通过，P2已关闭；原11项功能UI加新增旧图保留用例，合计12项不同功能UI，不叠加3项重复附件回归或录像驱动。修正后的构建契约21文件144项再次通过，固定发布来源 `4e38e599d03ed2ebe44dc6a2ae3f272ce2702619` 已绑定四项passed门禁；该来源同时包含已验收的正常动效与旧图修正，后续已由协调器发布0.3.35。

## 任务二：协调器发布

- [x] 固定来源执行ready，同一批次所有阶段已成功；正式main推进、打包和签名均由协调器完成。
- [x] 记录0.3.35（3035）、冻结SHA、正式及开发CI、全部阶段和真实成功receipt，核对包含本次功能及发布来源。
- 恢复边界：暂时只读错误继续同一批次；真实永久失败保留现场并登记显式关联最新失败叶的修复任务，不重跑或改写失败冻结。本轮未出现正式批次永久失败；下方LAN公共清单字段修正仅属于审计工具。

## 任务三：回验和交付

文件：新增 `docs/superpowers/plans/evidence/2026-10-24-followup-message-motion-release.json`，更新README、文档索引、交互约定、功能计划和本计划。

- [x] 成功receipt与实时complete状态一致后，独立核对双端清单、HEAD及完整GET的版本、大小和SHA-256。
- [x] 使用项目CA核对HTTPS OTA安装页、清单、manifest及版本化IPA；独立验签及完整权限／钥匙串连续性，不将其当成真机安装或数据保留验收。
- [x] 核对GitHub APK／unsigned IPA与普通、legacy软件源版本、构建号、URL、大小、散列、中文日志和动态账号署名保留；签名IPA只在OTA／LAN。
- [x] 正式结果及公共白名单凭证先规格、再质量独立审查，同步现役版本与已发布状态；旧0.3.34和历史失败链保留原口径。
- [x] 在共享main租约下完成纯文档收尾，停止自己的heartbeat，不重复构建或发布。
- [x] 准备并核对最终交付资料：固定OTA安装页、APK与已签名IPA下载链接、实际版本、两个包字节大小和完整SHA-256，随交付回复提供。

发布来源提交前核对远端main仍为 `86a3c35dfa7cacfa1d0744e624a5ae8412f52b43`，没有新增整合内容。旧图修正后的构建契约21文件144项再次通过（47.1秒），源码散列与最终UI GREEN对应；其他未受影响门禁复用真实通过日志。规格重审、最新交互记录确认及质量审查均通过，随后固定来源ready并完成下方协调器发布；此处保留发布准备来源记录，最终文档审查及整合见文末收尾记录。

## 正式发布与独立回验结果

任务 `followup-message-motion-release-20261024`、批次 `414677c8-d853-463c-9bda-a01d365680d0` 均complete，版本0.3.35（3035）；发布来源 `4e38e599d03ed2ebe44dc6a2ae3f272ce2702619` 及功能祖先 `86a3c35dfa7cacfa1d0744e624a5ae8412f52b43` 均包含于冻结提交 `bd2cf6911c2362d3e5c41f434966dc5cf31b2e5d`。实时complete状态、全部必要阶段和持久成功receipt一致；receipt的SHA-256为 `ed9c2f454f0dac9304a35ea6c2d601edf9c127336d8d0b7362817018d6ff2659`。正式双端CI [40058621764](https://github.com/zh0ngtian/codex-mobile/actions/runs/40058621764)及同冻结提交的开发CI [40058621841](https://github.com/zh0ngtian/codex-mobile/actions/runs/40058621841)均为attempt 1、success，[GitHub Release v0.3.35](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.3.35)已发布。

根代理独立渠道审计237/237通过，完整 `channel-audit.json` 的SHA-256为 `92e41a9400c87569ea49ed47190dd4ca09684b59857c6dd05ac6c6f75d991759`。固定LAN双端JSON、HEAD和完整GET匹配本次版本、大小与散列；HTTPS OTA安装页、JSON、manifest和版本化IPA均使用项目CA验证。真实下载的已签名IPA独立验签，与真实兼容基准的Bundle ID、Team、application-identifier、完整entitlements及钥匙串组连续性通过。GitHub APK／unsigned IPA、普通及legacy软件源的版本、构建号、URL、大小、散列、四条中文用户变化日志均一致，保留原开发者及动态读取的GitHub账号 `zh0ngtian`；Ad Hoc已签名IPA仅在OTA／LAN。

### 审计工具LAN公共字段修正

首轮审计工具错误要求固定LAN公共JSON包含内部 `buildNumber`、`sourceCommit`、`batchId`、`signed` 字段。公共清单按既有 `version`、`size`、`sha256`、`notes`、`downloadUrl`、`tag` 验收，所有必需字段仍须存在；构建号、来源、批次与签名状态由实时任务、完整receipt、正式CI构建receipt、完整下载散列及实际IPA验签／Info.plist分别证明，没有省略这些检查。

19项真实离线RED以7个失败、1个错误复现旧假设，修正后19/19 GREEN通过，随后重新完成237项渠道审计。原失败及红绿证据和工具源码散列保留于私有审计的 `harnessCorrections`；本次没有正式发布失败，不把此修正记成批次修复或重发。

### 产物、公共凭证及收尾边界

- [固定OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)。
- [固定APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)：0.3.35（3035），4,752,623字节，SHA-256 `48b36a8cfd341a99fa251fe40c0cc0f86c2509ce04274ba415134e8b96dcf9e7`。
- [固定Ad Hoc已签名IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)：0.3.35（3035），5,021,625字节，SHA-256 `0ca9316a252af77b2a3069f5af87ddaa99ad33e97e12e212a193b72ac604aa1d`。
- GitHub／软件源的unsigned IPA为5,010,913字节，SHA-256 `b750bcdcc2728867895f2949318190219a8fe03129ab299e0d2bcebf2d7a1d74`；不覆盖已签名渠道。

[公共凭证](evidence/2026-10-24-followup-message-motion-release.json)从白名单proposal原字节复制，SHA-256为 `28fad0ba5d294a6ce619e029a98614becdaa21a30ea859d4d54a5342e47d47b8`；55个键、35段字符串的白名单扫描通过，无私有路径、凭证或UDID，未将私有原始receipt和审计配置加入Git。本轮只发布客户端，未部署或验收网关；真机覆盖安装、数据保留、真机动效、真实网络发送及真实Bark送达仍待现场验收。离线夹具没有创建真实会话，专用模拟器已关闭；既有18.75秒正常速度录像继续保留，不重录。

纯文档收尾开始时的远端main及隔离工作区HEAD基线均为 `bd2cf6911c2362d3e5c41f434966dc5cf31b2e5d`。本次只更新上述5份文档与公共凭证，不重复构建、签名或更新渠道；文档最终规格与质量审查均通过，P0至P3无未解决问题；复用JSON、22个新增本地链接与差异检查，在共享main租约内核对远端并提交推送。主工作区原有10项暂存内容保持不动；本任务heartbeat已随ready退出，专用模拟器保持关闭。
