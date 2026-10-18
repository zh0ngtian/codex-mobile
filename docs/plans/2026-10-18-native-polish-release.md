# 原生界面改动合入main与正式发布

> 使用superpowers计划、TDD与完成前验证流程；在当前会话逐项执行，既有产品改动的红绿用例沿用各轮验收记录，发现新问题先复现再修复。

**目标：** 按用户明确要求合入main并发布GitHub Release，使用仓库默认双端协调目标完成固定渠道和OTA验收。

**架构：** 复用现有releasectl和发布主机状态库，由协调器整合、分配版本、冻结和推进main；不手动合并或独立发包。只影响客户端，不部署网关。

**工具：** releasectl、既有Python适配器、GitHub Actions、Xcode、Ad Hoc签名及固定渠道。

- [x] 登记任务`native-polish-release-20261018`到`codex-mobile-lan-production`，保持heartbeat。
- [x] 核对现行规则、中文更新日志、当前分支和远端main；未发布改动包括附件菜单、权限菜单、滚动、侧栏与页头、运行中关注及默认关闭的本地计时探针。
- [x] 运行`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录adapter-regression的真实退出码和日志。
- [x] 在协调器仓库运行`python3 -B -m unittest discover -s tests -p 'test_*.py'`，记录coordinator-recovery。
- [x] 运行`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`及`npm run typecheck`，记录build-contract和typecheck。
- [x] 提交推送固定SHA，生成绑定该SHA的验证文件，调用ready交给协调器。
- [ ] 等待main、GitHub构建/Release、本机签名、OTA、LAN双端和unsigned软件源回验；错误批次保持不可变，必要时只从最新失败叶节点关联修复。
- [ ] 核对成功receipt、任务祖先、Release附件、固定渠道完整下载散列和签名身份，更新交付记录并提供固定安装入口。

本次不执行真机安装。之前“仅模拟器”范围被本次明确发布授权覆盖；旧取消批次不恢复或改写。


## 关联编译修复

初始任务`native-polish-release-20261018`因未关联上次取消后的最新失败叶节点而未成批，已withdrawn。按协调约束登记`native-polish-release-linked-20261018`，关联旧失败批次`f54a3b76-2fb2-47b6-9d7c-c6bb6a206395`；新批次`86cae3ec-78ab-4d71-aeb3-f7c735ba15f2`已整合并推送main冻结提交`a323e3b04d11c2f8825002256de38a8aaa99c6f8`，预留0.3.7（3007）。Android和开发CI成功，但云端Xcode 26.3在`RootView.body`类型检查超时，未生成iOS包、未发布Release或更新渠道。失败批次和日志保持不变。

修复任务`native-polish-compile-repair-20261018`仅关联上述最新失败叶节点。将根视图的抽屉、sheet、三类alert和toast拆为独立opaque视图表达式，保留原修饰器顺序、状态归属和回调。以真实云端编译失败作为红例；本机Release/iphoneos编译通过，iPhone 17 Pro的业务小确认弹窗、确认结束后呈现审批、重命名取消三项回归通过（`/tmp/root-expression-compile-repair-1018.xcresult`）。继续完成门禁复检及正式CI验收，不复用失败版的安装包。

修复后167项发布适配回归、42项协调器恢复回归、138项构建契约与typecheck全部通过；独立审查将具名视图展开后逐项比对修饰器及回调顺序，未发现阻塞或重要问题。模拟器已退出夹具并恢复正常业务启动，本轮未创建测试会话。
