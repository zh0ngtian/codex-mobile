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

## 任务二：协调器正式双端发布

**文件：** 已推送来源及仓库外validation.json；正式产物和冻结清单由协调器生成。

- [ ] 以固定已推送SHA和真实validation.json执行ready；不手工推main或发起APK／IPA构建。
- [ ] 跟随同一批次main/build/iosbuild/sign/ota/apk/ipa/source/verify，等待真实成功receipt；暂时只读失败沿用同一批次恢复，永久失败按不可变失败链登记关联修复任务。
- [ ] 核对最终冻结SHA包含用户验收的功能提交和本发布任务来源；核对双端正式／开发CI、统一版本及长期产物。

## 任务三：独立回验与交付

**文件：** 新建 `docs/superpowers/plans/evidence/2026-10-23-new-conversation-motion-release.json`；更新本计划、`docs/interaction-alignment.md`、`README.md` 和 `docs/README.md`。

- [ ] 独立读取APK／IPA清单、HEAD及完整GET，核对版本、大小和SHA-256；使用既有项目CA核对HTTPS OTA安装页、清单、manifest和IPA。
- [ ] 核对已下载IPA签名身份、完整权限及钥匙串连续性；不把验签或模拟器验证说成真机覆盖安装。
- [ ] 核对GitHub unsigned IPA及软件源真实版本、构建号、URL、大小、散列、中文更新日志和原开发者署名；不上传Ad Hoc包到软件源。
- [ ] 对成功凭证与渠道结果先规格审查、再质量审查；保存脱敏公共凭证，更新现役和已发布状态。
- [ ] 在共享main互斥下完成纯文档收尾推送，不重复构建发布；停止任务heartbeat，保留唯一录像和验证证据。
- [ ] 最终回复展示固定OTA安装页、APK与已签名IPA下载链接、统一版本、两包字节大小和完整SHA-256。

## 发布准备实测

- 适配器217项、协调恢复59项、构建契约21文件144项及类型检查均退出0；iOS只读预检退出0。未更改生产运行代码，上一轮用户验收的11项原生UI、90项业务桥、9项呈现层及会话层回归按同一源码复核。
- 更新日志内容断言旧版先退出1（缺少“待发送”），新日志退出0；仅四条中文用户变化。规格审查发现功能计划状态缺少默认双端、尚无receipt和现役版本，已补全并独立复审通过。
- 准备前固定APK／已签名IPA均为0.3.32。当前GitHub登录用户名动态读取为 `zh0ngtian`；保留软件源既有开发者，不能以当前用户名覆盖旧署名。

独立规格与质量审查均已通过，无严重、重要或轻微未解决问题；来源差异仅上述四份发布准备文件。准备前四项门禁的日志退出码与SHA-256已逐一独立核对。
