# Remote 首次登记空设备哈希修复与部署计划

> 使用 Superpowers writing-plans、executing-plans 和 TDD；由当前主执行者执行与检查，不使用独立 agent。

**目标：** 修复真实 OAuth 成功后首次登记被拒绝，继续验证现役 Remote RPC 与持续连接。

**架构：** 只修正官方 REST 首次登记挑战的 nullable 字段解析；enroll 的 `device_identity_hash: null` 与缺省均表示尚未绑定，签名仍绑定网关自己的设备哈希；refresh 必须精确匹配，非空错误值继续拒绝。复用原实例、身份目录及协调器部署，不复制隔离探针身份。

**技术栈：** TypeScript、Vitest、既有 ReleaseCoordinator 与 launchd。

基线：`aa6a6c33686276c1d78f76bca189fb74b19b2e91`。任务：`remote-enrollment-null-hash-20261117`，仅网关内部修复，不改变客户端接口，不构建客户端或网页。

- [x] 定位：浏览器 OAuth 成功；无 enrollment 落盘；官方 enroll/start 两次 HTTP 200，设备哈希均为 null；同一响应仅去除该 null 后原校验通过，canonical 身份稳定。
- [x] 在 `tests/server/remote-auth.test.ts` 增加真实 nullable 首次登记成功、签名绑定自身哈希的测试，并补充 refresh null／错误类型拒绝。运行该文件，确认修复前预期失败。
- [x] 修改 `server/remote/auth-protocol.ts`：只在 enroll 接受 null／undefined；refresh 和非空值仍要求与自身哈希相同。运行相关认证、OAuth、controller 与 runtime 回归及服务端严格类型检查、构建。
- [x] 同步 `docs/interaction-alignment.md` 与管理文档，标明当前修复／现役待验收状态；完成 required checks，推送固定 SHA 后 ready，等待同一成功 receipt。
- [ ] 验证生产文件、网页及配置保留；完成首次授权和本机配对，实际只读 RPC，关闭手机逻辑连接后再调用验证主连接保活；如需用户重新授权，保留明确待办并交接。
- [ ] 保存脱敏证据，按实际结果更新文档，核对 main 最新提交后在共享锁下推送文档；测试会话如有创建及时归档。

最小解析改动：将首次登记的空哈希单独视为未绑定，其余输入沿用严格相等校验。执行测试 `node node_modules/vitest/vitest.mjs run tests/server/remote-auth.test.ts --maxWorkers=2`；预期 RED 为首次登记 null 被拒绝，GREEN 为全文件通过。之后运行 `tests/server/remote-{managed-auth,oauth,auth,controller,runtime}.test.ts` 及 `npm run build:server`。部署 ready 的四项门禁使用现行项目配置，私有验证记录 `scope=gateway-only`、`webUi=false`。

部署已完成：来源 `1f6836ee`，冻结 `018099dc5d2d9caabf5211fccf7343ee2c0dc550`，成功批次 `8165e654-74a1-4fef-b148-1daffe984c78`，开发 CI `44005877099` attempt 1 成功。编译产物包含修复，PID 59896→93624，原启动配置、token、网页及原工作区 main/index 保留；三项 HTTP 200。首次 RED 为99通过／1失败；五文件首轮370通过／3失败，Runtime 隔离重跑103通过／1失败，剩余同一边界单独重跑通过；合并覆盖373项，不宣称单次全绿，也没有为此修改相关夹具。双strict、服务端构建及四项部署门禁通过。现役尚未完成身份登记，修复后已重新发起授权，等待用户完成浏览器登录；RPC、持续连接及长期验收保持待完成。[脱敏收据](evidence/2026-11-17-remote-enrollment-null-hash.json)。
