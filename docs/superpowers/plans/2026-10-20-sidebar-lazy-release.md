# 边栏按需加载合入与双端发布实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 逐项执行；发布推进由现役 releasectl 负责。

**Goal:** 将边栏冷启动、摘要索引、五条窗口和折叠按需加载合入main，发布双端客户端并部署配套网关。

**Architecture:** 复用已验证的 `codex/sidebar-cold-profile-20261019` 隔离工作区，先整合最新远端main并核对相关回归。客户端与网关分别登记、heartbeat，并ready同一已推送SHA；协调器持共享main锁完成冻结、版本分配、构建、签名和渠道回验。两份成功receipt均核对后交付，不自行正式发包。

**Tech Stack:** TypeScript/React、SwiftUI、Vitest、Python unittest、releasectl、现有GitHub双端CI及Ad Hoc OTA。

---

### 1. 登记与整合

- [x] 记录开发分支 `5ae0847`，初始远端main基线 `e0062a17154b40e573681e6e53994db987979759`；整合期间更新至 `96800a898cb7cc23c0c087f6394b96935b0190b0`，已纳入。
- [x] 登记 `sidebar-lazy-release-20261020-client` / `sidebar-lazy-release-20261020-gateway`，持续heartbeat。
- [x] `git merge --no-commit --no-ff origin/main`，保留双方交互文档；核对 `src/App.tsx`、原生投影及Swift会话五条窗口的合并结果。
- [x] 更新 `release/notes.md`，只列本次相对已发布渠道的用户变化。

### 2. 整合验证与必要修复

- [ ] `NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=2 --testTimeout=60000`，验证边栏与主分支消息、执行过程行为兼容。
- [x] `npm run typecheck && npm run build && npm run build:server`。
- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`；其中适配器回归、恢复回归单列真实日志。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，记录build-contract门禁。
- [x] 如发现阻挡发布的缺陷：先增加最小失败回归并确认失败原因，再做最小修复，定向通过后执行受影响集合；不得修改测试掩盖失败。
- [x] 原生客户端自动合并涉及当前main其他Swift改动，使用独立iPhone17Pro正常字号竖屏完成必要整合构建/行为核对；同一模拟器独占。

### 3. 推送并交协调器发布

- [ ] 按中文Conventional Commits提交整合结果并推送，验证精确SHA远端存在。
- [ ] 生成仓库外validation，包含真实passed的 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck` 及命令/结果日志。
- [ ] 两任务ready同一SHA，等待协调器分别完成；不修改冻结工作区，不独立运行正式发包入口。
- [ ] 失败保持原批次不可变；必要关联修复绑定最新失败叶节点，不resume已失败批次。

### 4. 验收与交付

- [ ] 核对客户端和网关成功receipt、任务祖先、冻结SHA与实际main。
- [ ] 核对GitHub APK/unsigned IPA、固定LAN APK/已签名IPA、HTTPS OTA及软件源unsigned版本/中文日志/保留署名。
- [ ] 核对网关部署摘要、实际launchd进程、监听与认证接口；不把模拟器验证当作真机覆盖安装。
- [ ] 更新交互状态与发布凭证记录，提交并推送文档；停止本任务heartbeat。
- [ ] 最终提供固定OTA安装页、APK与已签名IPA的版本、字节大小和完整SHA-256。

## 整合检查记录

- 首轮完整回归161文件1843项中1841通过，2项图片过程测试仍使用运行时默认折叠的旧断言；对应测试与运行呈现源码和main逐字节一致。按已批准的运行时默认展开要求，补查初始展开状态并验证手动折叠/重开，保留原图片按路径去重、原始位置与请求数断言，定向2文件33项通过；不修改生产呈现代码。
- 发布Python212项、构建契约20文件143项、类型检查与前后端构建通过。原生临时工程首轮因残留嵌套assets与平铺资源重复而未进入测试，清理生成目录后重试通过2项，耗时61.2秒；包含五条窗口及运行过程完成状态，真实源码同步核对。
