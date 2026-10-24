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

准备证据已保存至上述私有目录：`notes-red.json`／`notes-red.log`记录旧说明缺少“后续”、真实退出1；`notes-green.json`／`notes-green.log`记录同一断言通过、真实退出0。四项门禁与只读预检各有同名JSON／log，现役APK与IPA基线均为0.3.34；此处仅记录发布准备结果，不代表已有成功发布receipt。

### 独立规格审查发现的图片保留P2

下一次发送会撤销上一条消息的临时预览，远端加载慢／失败的旧图片因此退回占位并改变历史高度。先增加真实UI失败用例及显式DEBUG不可达图片回执，保持输入区真实PNG不变；原产品源码RED为1项失败，可访问图片高度约171.7pt降为29.7pt，靛蓝像素变为背景色。最小修正仅在 `OutputImageCard` 内按媒体身份保留已显示预览，优先成功远端图；媒体改变隔离旧图，同媒体任务重启保留图片，取消任务不写回失败。没有新增全局缓存或改动发送／队列业务。

最终源码GREEN完成4项UI（新保留用例、后续混合附件原位交接、后续仅附件、首条附件过渡），0失败，121.6秒；设备范围为iPhone 17 Pro／iOS27、正常字号、竖屏。证据位于 `.mobile-build/followup-message-motion-20261024/preview-retention-{red,green}.xcresult`、对应日志／截图及 `preview-retention-evidence.json`，包含原产品和最终源码散列；首轮GREEN另存 `preview-retention-green-initial.*`。新用例核对正式用户气泡数量、旧图高度和真实截图像素，未放宽消失断言。正常动效路径沿用18.75秒录像；旧 `development-evidence-recheck.json` 仅证明修正前来源，不代替本次差异和新GREEN。没有创建真实网关会话，专用模拟器已关闭。

本地修正已验证，独立规格重审与后续质量审查仍待完成；其余门禁及固定SHA证明由主执行代理按本次源码变化更新。此时仍为发布准备中，无成功receipt，现役0.3.34不变；未提交、推送、ready、分配版本、冻结、正式构建、签名或发布。

## 任务二：协调器发布

- [ ] 固定来源执行ready，等待同一批次所有阶段成功；不手工推进main或启动正式打包签名。
- [ ] 记录分配版本、冻结SHA、正式及开发CI、全部阶段和真实成功receipt，核对包含本次功能及发布来源。
- [ ] 暂时只读错误继续同一批次；真实永久失败保留现场并登记显式关联最新失败叶的修复任务，不重跑或改写失败冻结。

## 任务三：回验和交付

文件：新增 `docs/superpowers/plans/evidence/2026-10-24-followup-message-motion-release.json`，更新README、文档索引、交互约定、功能计划和本计划。

- [ ] 成功receipt与实时complete状态一致后，独立核对双端清单、HEAD及完整GET的版本、大小和SHA-256。
- [ ] 使用项目CA核对HTTPS OTA安装页、清单、manifest及版本化IPA；独立验签及完整权限／钥匙串连续性，不将其当成真机安装或数据保留验收。
- [ ] 核对GitHub APK／unsigned IPA与普通、legacy软件源版本、构建号、URL、大小、散列、中文日志和动态账号署名保留；签名IPA只在OTA／LAN。
- [ ] 正式结果及公共白名单凭证先规格、再质量独立审查，同步现役版本与已发布状态；旧0.3.34和历史失败链保留原口径。
- [ ] 在共享main租约下完成纯文档收尾，停止自己的heartbeat，不重复构建或发布。
- [ ] 最终提供固定OTA安装页、APK与已签名IPA下载链接、实际版本、两个包字节大小和完整SHA-256。

发布来源提交前核对远端main仍为 `86a3c35dfa7cacfa1d0744e624a5ae8412f52b43`，没有新增整合内容。旧图修正后的构建契约21文件144项再次通过（47.1秒），源码散列与最终UI GREEN对应；其他未受影响门禁复用真实通过日志。规格重审、最新交互记录确认及质量审查均通过，尚未ready或生成新成功receipt。
