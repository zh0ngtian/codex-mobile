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
- [x] 用户确认发布范围后整合最新main、补齐受影响验证，再提交ready。
- [x] 等待协调器main、GitHub双端构建/Release、本机签名、OTA、固定APK/IPA、unsigned软件源及共同成功receipt；失败按最新失败叶节点关联修复。
- [x] 独立核对固定JSON、HEAD、完整GET、版本、大小与SHA-256及软件源中文日志/署名；恢复正常模拟器App、释放锁并同步交付记录。

原始录屏和前一轮逐帧证据保留于主工作区 `.mobile-build/investigation-entry-recording-20261019/`。未取得实际逐帧及成功批次证据前，不标记修复已验证或已发布。

## 已定位原因与最小修复

静态会话高度2336.33→2454.67pt时，偏移仍为1619.33pt，下一显示帧距离底部118.33pt，稍后才变为1737.67pt。高度观察回调发出的ScrollViewReader定位在当次布局尚未提交时未立即改变偏移，异步调度使旧偏移进入显示帧。通过SwiftUI的initialOffset底部锚点在首次布局完成定位，sizeChanges底部锚点在同次高度回填布局保持跟随意图；alignment保留默认短内容顶对齐，用户阅读/手动动画/历史加载时停用尺寸跟随，现有末尾ID交接保持。最终验收使用同一呈现树的内容底边和视口，拒绝模型offset造成的假绿；两轮共20次进入、992帧/793个有效可见帧零错误，12项不同界面用例最终通过；3项按真实offset准备阅读状态的测试又定向复验通过，保留原动画、分页计数及阅读锚点断言。

发布基线main还含已按用户要求单独提交、未发布的输入区中性色调整9ef2cce。本次不覆盖该实现，复验现行输入栏布局/中性色，并在本次正式发布日志中列出实际合入产物的用户变化。

## 发布范围已获确认

用户明确回复“一起发布”，授权整合main的Sidechat及配套生产网关。恢复客户端任务active，新增网关任务`native-entry-position-gateway-20261019`，两目标持续heartbeat，整合95f6234后补齐受影响验证并ready同一SHA；分别核对两份成功receipt。此前blocked期间未分配版本或更改正式渠道。

## 联合发布补充验证与交付

- [x] 完成文档冲突整合，保留闪烁修复、Sidechat、输入区中性色及全部现行约定。
- [x] 合并后运行全量Vitest、typecheck、服务端构建、适配器与协调恢复回归。
- [x] iPhone17Pro正常字号竖屏复验普通会话逐帧位置与Sidechat往返/关闭；创建的临时分支及时关闭。
- [x] 独立合并审查通过，中文提交并推送统一SHA。
- [x] 网关先ready并核对成功凭证，再对客户端ready同一SHA。
- [x] 等待两个成功批次，独立核对APK、签名IPA、OTA、unsigned软件源及生产网关。

联合审查按红绿回归修复5项Sidechat边界：原草稿在同步入队前保留；恢复保留对象身份、在途及UUID锁；关闭后拒绝迟到恢复；审批完成通知传递全局队列；实时busy开始/完成优先于旧read。原4项管理器回归、2项App失败输入回归及正反busy时序先失败后通过；加入已入队失败不重复恢复及上传期间继续编辑覆盖，最终3文件34项通过，独立复审无剩余阻塞。iOS关闭菜单统一以元素中心点击，保留原菜单消失和确认/取消断言；测试失败创建的临时分支已按创建时间准确关闭，旧分支保留。

## 正式联合交付

正式联合发布已完成：客户端版本0.3.17（3017），客户端成功批次`8b5c6bc7-0aa7-4f0e-91c1-5add42278dfc`、冻结main`a9316f32de1a4c87b31cdc8fc79bf7d5d48863ba`；网关成功批次`cd8e1130-61a5-4b7f-a6f0-1f6b50ca6a4f`、冻结main`1f215f542355fee2b279a8c3aa28906d655ece3f`。两目标ready同一源码`fbfc111b96a8d99dfe7e313322e05dd24ba664f6`，均已核对源码包含与必要CI成功。固定APK/已签名IPA和HTTPS IPA经独立HEAD/完整GET校验，OTA清单、manifest、安装页、签名身份/完整权限与钥匙串组、unsigned软件源版本、中文日志和既有署名均通过。生产网关独立认证探测确认Sidechat路由生效，未创建生产测试会话。模拟器已恢复无测试参数的正常App并移除探针，锁已释放；本轮临时分支已全部关闭，旧分支保留。详见[公共交付凭证](evidence/2026-10-19-entry-sidechat-release.json)。未进行真机覆盖安装和数据保留验收。
