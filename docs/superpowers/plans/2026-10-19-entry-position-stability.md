# 原生会话首次进入位置稳定性修复计划

> 使用 superpowers 的系统排查、计划与 TDD 流程，在当前会话逐项执行。

**目标：** 修复录屏3.567秒处正文单帧回到较早位置又恢复的问题；首次显示和布局回填期间保持应有的底部阅读位置。

**实现边界：** 沿用当前 SwiftUI ScrollView、末尾消息ID、历史分页和用户滚动意图。先取得逐帧位置/高度及定位请求时序，再选择最小修复；不通过固定延时或额外淡入掩盖回跳。保持已发布的透明度修复、顶部刷新及现行输入栏。

**技术栈：** SwiftUI、UIKit、CADisplayLink、XCTest、Vitest、releasectl。

## 根因与失败回归

- [x] 核对用户录屏：3.550秒正常、3.567秒回跳并出现回底箭头、3.583秒恢复；旧透明度探针无法覆盖位置问题。
- [x] 登记默认双端任务 `native-entry-position-20261019`，建立独立worktree；持续heartbeat并排队使用共享模拟器。
- [x] 在 `NativeLoadRenderProbe.swift` 与现有加载分析记录中采样每帧contentOffset、呈现层偏移、contentSize、viewport、insets和底部定位时序；不记录正文、连接地址或凭据。
- [x] 同一呈现树的两类真实会话五轮共10次进入、490帧（390个有效可见帧）检出5个错误帧，静态会话最大118.33pt；对应快照正文计数及context均未变。`analyze-conversation-entry.py --require-stable`实际返回1。8项分析器回归通过，含模型正确而呈现错误、旧呈现布局仍正确及缺少有效可见帧；审查中发现的两项验收漏洞先失败再修复通过。共享模拟器被其他任务占用，使用独立同型号同系统实例并复用私有测试配置。

## 最小修复与验证

- [x] 根据同步时序证据修复 `NativeConversationScrollAccess.swift` / `ConversationScreen.swift` 的首次布局或锚点交接边界；每次只改变一个原因。
- [x] 验证逐帧位置检查由失败转为通过；覆盖首次加载、往返会话、长报告/表格、后续内容回填、运行中跟随、用户阅读和历史前插锚点。
- [x] iPhone17Pro正常字号竖屏录屏核对正文与回底按钮，补齐此前只检查透明度及两秒后正文像素的验收缺口；测试会话如有创建须归档。

## 文档与发布

- [x] 同步 `docs/interaction-alignment.md` 现行要求、验收和状态，更新中文 `release/notes.md`，只列本次用户变化。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`、协调器59项回归、`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000` 及 `npm run typecheck`，分别212、59、140项及类型检查通过，实际日志已保存。
- [x] 独立审查和`git diff --check`通过，按中文Conventional Commits提交并推送修复分支。
- [ ] 用户确认发布范围后整合最新main、补齐受影响验证，再提交ready。
- [ ] 等待协调器main、GitHub双端构建/Release、本机签名、OTA、固定APK/IPA、unsigned软件源及共同成功receipt；失败按最新失败叶节点关联修复。
- [ ] 独立核对固定JSON、HEAD、完整GET、版本、大小与SHA-256及软件源中文日志/署名；恢复正常模拟器App、释放锁并同步交付记录。

原始录屏和前一轮逐帧证据保留于主工作区 `.mobile-build/investigation-entry-recording-20261019/`。未取得实际逐帧及成功批次证据前，不标记修复已验证或已发布。

## 已定位原因与最小修复

静态会话高度2336.33→2454.67pt时，偏移仍为1619.33pt，下一显示帧距离底部118.33pt，稍后才变为1737.67pt。高度观察回调发出的ScrollViewReader定位在当次布局尚未提交时未立即改变偏移，异步调度使旧偏移进入显示帧。通过SwiftUI的initialOffset底部锚点在首次布局完成定位，sizeChanges底部锚点在同次高度回填布局保持跟随意图；alignment保留默认短内容顶对齐，用户阅读/手动动画/历史加载时停用尺寸跟随，现有末尾ID交接保持。最终验收使用同一呈现树的内容底边和视口，拒绝模型offset造成的假绿；两轮共20次进入、992帧/793个有效可见帧零错误，12项不同界面用例最终通过；3项按真实offset准备阅读状态的测试又定向复验通过，保留原动画、分页计数及阅读锚点断言。

发布基线main还含已按用户要求单独提交、未发布的输入区中性色调整9ef2cce。本次不覆盖该实现，复验现行输入栏布局/中性色，并在本次正式发布日志中列出实际合入产物的用户变化。

## 发布范围待确认

发布前同步远端发现origin/main新增Sidechat及配套网关（95f6234），其现行记录明确为用户要求仅合入main、未发布。修复分支仍基于9ef2cce，未混入该增量。按默认发布会带上这项完整产品能力，不能擅自只发客户端或部署配套网关；待用户确认后继续。当前仅提交推送修复，协调任务标记blocked且不提交ready，未分配版本或更改正式渠道。
