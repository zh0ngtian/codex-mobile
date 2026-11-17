# Remote 身份误判修复与恢复计划

> 当前主执行者使用 superpowers:executing-plans 逐项执行，按用户要求不使用独立 agent。

**目标：** 修复业务读取失效被转换为身份变化的问题，恢复原授权 Remote，并实测网页刷新和打开对话耗时。

**架构：** 保留现有身份、账号、本机完整目标和显式恢复规则。认证边界分类外部异常前先复核可信父操作；父操作已失效时沿用其分类，不持久化身份暂停。真正凭据变化仍按原规则暂停，不自动采用新身份。

**技术栈：** TypeScript、AsyncLocalStorage、Vitest、现有 ReleaseCoordinator 与 launchd。

基线 origin/main：`2f310e01b52e9f08d0b789426ae1841f0fdff5c4`；本地 main `7772b28f5e716d8e5e3759fb1e84a089158502ec`。工作区沿用独立 `codex/remote-gateway-20261113`，已快进到远端基线。部署任务 `remote-identity-fault-20261117`。本轮仅服务端内部修复，保留现役网页，不发布客户端。

## 1. 复现与最小修复

- [x] 核对网页 503、运行实例 fault、持久暂停，以及当前凭据与活动账号身份一致且未过期。
- [x] 在 `tests/server/remote-runtime.test.ts` 用真实 Runtime、ManagedAuthLoader、AuthProvider 和 Relay 夹具，分别于文件读取、硬件身份读取返回时使可信父操作抛出 `RemoteRuntimeError('unavailable')`。断言请求拒绝为 unavailable、原 generation 和 online 保持、持久 `paused=false`、新请求仍能读取。
- [x] 运行 `npm test -- tests/server/remote-runtime.test.ts -t '父操作失效' --maxWorkers=1`，保存预期 RED（当前实现误报 identity-changed）。
- [x] 修改 `server/remote/managed-auth.ts` 与 `server/remote/auth.ts` 的异常分类边界，先执行 `assertRemoteOperation()` 再进行原有外部异常脱敏；不直接信任外部回调抛出的类型或文本。

```ts
catch (error) {
  assertRemoteOperation();
  // 继续原有外部异常分类；可信父检查失败直接离开此边界。
}
```

- [x] 运行认证、受管凭据、Runtime、控制器、生命周期和网关 Remote 集成回归；确认真实换号/撤权仍持久暂停及超时晚结果不能新建资源。
- [x] 更新 `docs/interaction-alignment.md` 的现行要求、验收状态与变更记录，运行 typecheck、服务端 strict 与 `build:server`。

## 2. 固定来源部署

- [x] 运行四项 ready 门禁：Python 适配器、协调器恢复、`tests/ci` 契约和 typecheck，保存命令、日志与退出码。
- [ ] 核对最新远端 main 并回归整合结果，提交中文 Conventional Commit、推送固定来源；私有 validation 声明 gateway-only、webUi=false，经协调器 ready 并等待 main/gateway/verify 成功。
- [ ] 验证持久 receipt 与实际安装文件、原网页摘要、环境配置、token 和原授权身份。

## 3. 原身份恢复与网页计时

- [ ] 通过既有 Mac CLI `remote resume --environment-id <原环境> --installation-id <原安装>` 显式恢复同一完整目标；不删除状态文件、不新建身份或扩大权限。
- [ ] 核验 online、公开 Remote 只读 RPC 和持续连接；直接网页计时刷新完成与正文及输入框就绪。若仍失败保留真实结果，不能把缓存出现或错误返回视为完成。
- [ ] 保存脱敏证据，更新计划及现役文档，收尾提交推送；不创建模型测试对话，若创建则及时归档。

本地结果：先前原两项RED均误报identity-changed，修复后GREEN；最终六个父失效场景及相关6文件293项回归通过，290项适配器、164项构建契约、59项协调器、typecheck、服务端strict和build:server通过。显式resume复核原完整身份后online，generation不变且pending清空。私有日志 `/private/tmp/remote-identity-fault-20261117`。
