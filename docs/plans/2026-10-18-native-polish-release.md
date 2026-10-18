# 原生界面改动合入main与正式发布

> 使用superpowers计划、TDD与完成前验证流程；在当前会话逐项执行，既有产品改动的红绿用例沿用各轮验收记录，发现新问题先复现再修复。

**目标：** 按用户明确要求合入main并发布GitHub Release，使用仓库默认双端协调目标完成固定渠道和OTA验收。

**架构：** 复用现有releasectl和发布主机状态库，由协调器整合、分配版本、冻结和推进main；不手动合并或独立发包。只影响客户端，不部署网关。

**工具：** releasectl、既有Python适配器、GitHub Actions、Xcode、Ad Hoc签名及固定渠道。

- [x] 登记任务`native-polish-release-20261018`到`codex-mobile-lan-production`，保持heartbeat。
- [x] 核对现行规则、中文更新日志、当前分支和远端main；未发布改动包括附件菜单、权限菜单、滚动、侧栏与页头、运行中关注及默认关闭的本地计时探针。
- [ ] 运行`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录adapter-regression的真实退出码和日志。
- [ ] 在协调器仓库运行`python3 -B -m unittest discover -s tests -p 'test_*.py'`，记录coordinator-recovery。
- [ ] 运行`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`及`npm run typecheck`，记录build-contract和typecheck。
- [ ] 提交推送固定SHA，生成绑定该SHA的验证文件，调用ready交给协调器。
- [ ] 等待main、GitHub构建/Release、本机签名、OTA、LAN双端和unsigned软件源回验；错误批次保持不可变，必要时只从最新失败叶节点关联修复。
- [ ] 核对成功receipt、任务祖先、Release附件、固定渠道完整下载散列和签名身份，更新交付记录并提供固定安装入口。

本次不执行真机安装。之前“仅模拟器”范围被本次明确发布授权覆盖；旧取消批次不恢复或改写。
