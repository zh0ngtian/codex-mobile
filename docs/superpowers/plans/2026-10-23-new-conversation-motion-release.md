# 新会话首条发送动效双端发布实施计划

> **执行代理须知：** 使用 superpowers:subagent-driven-development 逐项执行，先规格审查、再质量审查；正式版本分配、冻结、构建、签名与渠道写入只交给现役 releasectl。用户已明确授权发布，连续执行本计划，无需再次询问执行方式。

**目标：** 将用户看过视频并确认的首条发送动效发布到默认双端固定渠道，核对成功凭证及真实下载后交付安装链接。

**架构：** 复用当前独立 worktree、现役协调器及 codex-mobile-lan-production 目标；只发布客户端，不部署网关。来源包含功能提交 `3dcb0971b479ee4baef07e5806d7ef67992acfd3`，发布准备基线为远端 main `60f0a1f5c27ebf5f727a6a25b0635fe6926cce7c`；版本只由协调器分配。

**技术栈：** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、既有 Ad Hoc 签名、HTTPS OTA、固定 LAN 与 unsigned IPA 软件源订阅。

---

## 任务一：准备发布来源与门禁

**文件：** 修改 `release/notes.md`、`docs/interaction-alignment.md` 与本计划；不改生产运行代码。仓库外验证目录为 `~/Library/Application Support/ReleaseCoordinator/validations/new-conversation-motion-20261023/`。

- [x] 登记 `new-conversation-motion-release-20261023`，检查现役0.1.7协调器健康，启动35秒heartbeat；复用已隔离工作区，不触碰主工作区无关暂存内容。
- [x] 读取最新版 SignOs 软件源说明、动态读取当前GitHub用户名，保留原开发者，仅同步原unsigned订阅。
- [x] 先用以下旧日志内容断言记录失败，再更新为中文用户可感知变化并验证通过：
  ```python
  from pathlib import Path
  text = Path('release/notes.md').read_text()
  for expected in ['待发送', '机器', '项目', '附件', '待确认', '编辑']:
      assert expected in text, expected
  ```
- [x] 新日志完整内容：
  ```text
  - iOS 新会话点击发送后立即进入“待发送”画面，首条消息连续过渡到气泡，确认后原位显示。
  - 机器和项目选择按钮平滑退场，所选目标由会话页头继续展示，输入栏随键盘连续归位。
  - 支持文字、图片与文件、多附件及仅附件的发送过渡，保留预览和文件名，长附件确认时保持位置。
  - 发送失败保留正文与附件并支持返回编辑；结果待确认时防止重复发送，迟到确认后自动更新状态。
  ```
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，保存adapter-regression实测日志与退出码。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，保存coordinator-recovery。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，保存build-contract；执行 `npm run typecheck` 保存typecheck。
- [x] 执行只读iOS预检 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --notes '新会话首条发送动效发布预检' --plan`，不独立执行正式发包。
- [x] 复核上一轮11项UI、90项业务桥、9项呈现层及会话Swift回归记录，确认源代码未变；发布准备不重写已验收动效。
- [x] 完成独立规格与质量审查，修正阻塞问题；按中文Conventional Commits提交推送发布分支，validation.json绑定完整SHA及四项passed门禁证据。

## 任务二：协调器正式双端发布（由关联修复批次完成）

**文件：** 正式产物和冻结清单由协调器生成；0.3.33永久失败批次保持不可变，成功交付由修复任务 `new-conversation-motion-release-repair-20261023` 完成。

- [x] 关联修复来源 `0f755e22462c6e234b9748a3f53f327e3c8cbe5d` 以固定SHA和真实validation.json提交ready；不手工推main或发起APK／IPA构建。
- [x] 修复批次 `73c0f9d2-ad52-4b4e-97cb-b6d6b1aee012` 的main/build/iosbuild/sign/ota/apk/ipa/source/verify全部完成并取得成功receipt。
- [x] 冻结SHA `d7d5a7f39fa11452b852b73531ab156a006373da`包含用户验收功能和发布来源；统一交付0.3.34（3034）。正式CI `39989940336` attempt 1及开发CI `39989940382`成功。

原批次 `8830fd0b-c53d-44e0-960d-1e31a6c59c02`／0.3.33仍为永久失败历史，未被修复批次改写或复用。

## 任务三：独立回验与交付

**文件：** 已生成 `docs/superpowers/plans/evidence/2026-10-24-new-conversation-motion-release.json`；更新本计划、`docs/interaction-alignment.md`、`README.md` 和 `docs/README.md`。

- [x] 独立读取APK／IPA清单、HEAD及完整GET，核对版本、大小和SHA-256；使用既有项目CA核对HTTPS OTA安装页、清单、manifest和IPA。
- [x] 核对已下载IPA签名身份、完整权限及钥匙串连续性；未将验签或模拟器验证说成真机覆盖安装。
- [x] 核对GitHub unsigned IPA及软件源真实版本、构建号、URL、大小、散列、中文更新日志和原开发者署名；未上传Ad Hoc包到软件源。
- [x] 对成功凭证、渠道结果及收尾文档完成独立规格审查、再质量审查；P0至P3均无未解决问题。
- [x] 公共白名单凭证已复制，现役和已发布状态已更新；完整审计为197/197，SHA-256 `0836290d1c9c885c5a5e8ddc1d39b85b74891a640ce0b611d53922df7367cfc7`。
- [x] 文档经独立审查并纳入共享main租约保护的纯文档整合；不重复构建发布，保留唯一录像和验证证据。
- [x] 交付信息已核对齐备：固定OTA安装页、APK与已签名IPA下载链接、统一版本、两包字节大小和完整SHA-256；最终回复使用同一凭证数据。

## 首次批次发布准备实测

- 适配器217项、协调恢复59项、构建契约21文件144项及类型检查均退出0；iOS只读预检退出0。未更改生产运行代码，上一轮用户验收的11项原生UI、90项业务桥、9项呈现层及会话层回归按同一源码复核。
- 更新日志内容断言旧版先退出1（缺少“待发送”），新日志退出0；仅四条中文用户变化。规格审查发现功能计划状态缺少默认双端、尚无receipt和现役版本，已补全并独立复审通过。
- 准备前固定APK／已签名IPA均为0.3.32。当前GitHub登录用户名动态读取为 `zh0ngtian`；保留软件源既有开发者，不能以当前用户名覆盖旧署名。

独立规格与质量审查均已通过，无严重、重要或轻微未解决问题；来源差异仅上述四份发布准备文件。准备前四项门禁的日志退出码与SHA-256已逐一独立核对。

## 首次正式构建失败与关联修复

原批次 `8830fd0b-c53d-44e0-960d-1e31a6c59c02` 冻结 `b0e0f202506bc72bbe0f5aabdccf6938102eee8a`，分配0.3.33（3033）。正式CI `39978323298` 的Android成功，iOS在Xcode26.3的Release编译中报 `ConversationSurface.swift` 透明度计算的CGFloat／Double减法重载歧义；开发CI成功。失败批次保持不可变，没有签名、OTA或固定渠道写入，也没有GitHub双端Release，现役仍0.3.32。

已登记关联修复任务 `new-conversation-motion-release-repair-20261023`，明确绑定该失败叶节点。修复基线为上述冻结main；只显式转换两处透明度数值类型，保留原公式、轨迹、时长和交互。真实CI编译错误作为RED证据，先做数学等价与本机Release编译、相关原生回归及全部发布门禁，再推固定来源提交ready；云端旧Xcode GREEN仍须以新成功批次为准。版本继续由协调器分配，不回收已保留的0.3.33。

### 本机验证环境等待系统授权（历史阻塞，2026-10-24已恢复）

两行显式数值修复已完成，10007个数学采样与原映射完全一致；独立规格、质量审查通过，217项适配器、59项协调恢复、144项构建契约和类型检查再次通过。尚未提交ready。

当时本机Xcode在任务期间更新为27.1，CoreSimulator仍为1171.7，simctl要求的组件为1174.9.2。`xcodebuild -checkFirstLaunchStatus` 返回69，初始化进程日志停在管理员认证；`sudo -n -v` 返回1并明确需要密码。Release编译和新一轮UI验收尚未执行完成，不能标为通过，也不能替代云端Xcode26.3 GREEN。修复任务标记blocked，等待用户在本机完成 `sudo xcodebuild -runFirstLaunch` 的系统授权后继续原生验证、提交来源和关联修复批次。未改SDK、未跳过门禁、未回退动效或使用未签名包交付；固定渠道仍0.3.32。

### 2026-10-24 系统授权后继续

用户完成Xcode初始化后明确要求继续。`xcodebuild -checkFirstLaunchStatus` 返回0，CoreSimulator已更新至1174.9.2；原修复任务从blocked恢复active并继续heartbeat。本机Xcode27.1的Release模拟器编译已通过，三项原生发送回归最终3/3通过（75.4秒）。源代码仍仅两处明确数值转换，之前通过的四项门禁日志散列复核一致，期间远端main没有新增提交，复用已有门禁结果；未把本机编译当作云端26.3验证。

新Xcode首次UI快照在仅附件发送事件约2.05秒后才检查待发送，晚于原夹具1.7秒回执；消息与附件最终均正常，仅短暂状态断言失败。三项发送验收统一使用既有3.5秒慢回执夹具，保持原状态、附件和单气泡断言不变，确定“回执前验收”的测试前置条件；不改产品发送时序。最终三场景UI3/3通过，构建契约144项通过。

恢复后最终验证：本机Release编译通过，三项原生发送验收3/3通过（75.4秒）。慢回执稳定覆盖等待态后，纯文字旧断言还错误要求透明节点销毁；按已批准的“淡出且不可交互”要求，改为检查节点不存在或不可命中，并结合当前截图确认按钮不可见、页头正常承接，其他状态／附件／单气泡断言与超时保持不变。生产代码仍仅两行类型转换，规格复审通过；最终测试差异的独立规格与质量复审均通过，无未解决问题，可提交ready。

修复来源提交前再次核对远端main仍为 `b0e0f202506bc72bbe0f5aabdccf6938102eee8a`，无新增整合内容。本机Release与三项UI验证完成，最终构建契约21文件144项通过，其他未受测试前置条件影响的门禁日志散列复核一致。修复来源经独立规格、质量复审后推送固定SHA，仅提交关联修复任务ready，不恢复或改写原失败批次。

## 关联修复批次最终交付（0.3.34，渠道审计已通过）

批次 `73c0f9d2-ad52-4b4e-97cb-b6d6b1aee012` complete，冻结 `d7d5a7f39fa11452b852b73531ab156a006373da`，来源 `0f755e22462c6e234b9748a3f53f327e3c8cbe5d`，版本0.3.34（3034）。正式CI `39989940336` attempt 1全部成功（Android成功，iOS Xcode 26.3日志为 `BUILD SUCCEEDED`）；开发CI `39989940382`成功。本机Release编译成功，原生发送UI最终3/3通过（75.4秒）；217项适配器、59项协调器恢复、144项构建契约和typecheck通过。

独立真实渠道审计197/197通过，完整审计文件 `channel-audit.json` 的SHA-256为 `0836290d1c9c885c5a5e8ddc1d39b85b74891a640ce0b611d53922df7367cfc7`。首轮审计因cwd解析CA相对路径而失败，审计harness改为基于配置目录解析后13/13自检通过，随后完整197项重审通过；首轮记录保留。该脚本环境问题不代表正式发布批次失败。原0.3.33永久失败链保持不变；审计还确认其恢复关系与0.3.34成功批次。

| 产物 | 版本 | 大小 | SHA-256 | 固定下载地址 |
| --- | --- | ---: | --- | --- |
| APK | 0.3.34（3034） | 4,752,699字节 | `bdece3a1f81047a59b0edc4dd7cf9d5882928697a9afcb35ee4d002cd4ce007a` | [固定APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) |
| Ad Hoc已签名IPA | 0.3.34（3034） | 4,993,069字节 | `f74cd53ade21dc9c048b6874efce1f37bd5da9a034bbde11c41e4ebc90c63332` | [固定IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) |

HTTPS OTA安装页：[固定安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)，iOS清单为 `https://192.168.123.79:8766/channels/codex-mobile/current/latest-ios.json`。GitHub Release为[v0.3.34](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.3.34)；unsigned软件源IPA版本0.3.34、构建号3034、4,985,645字节、SHA-256 `1c095b321671ba0caaebd4ccff27d76a8a7abc862a07d31a2335ed226379411b`，保留开发者署名 `zh0ngtian`。

本轮未部署网关。模拟器已Shutdown，离线fixture未创建真实会话；真机覆盖安装、数据保留及真实Bark送达仍未验证。成功凭证、渠道结果及收尾文档的独立规格和质量审查均通过，P0至P3无未解决问题。纯文档收尾基线为 `d7d5a7f39fa11452b852b73531ab156a006373da`；整合前远端main未新增提交，复用已完成的JSON、22个新增本地链接及差异检查，在共享main租约下提交推送。冻结清单、运行代码及已发布安装包均不变。
