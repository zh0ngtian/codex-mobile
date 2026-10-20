# 模型提问 UI 与通知实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在本会话逐项执行，遵循 TDD，不委派共享状态工作。

**Goal:** 模型提问时可在手机回答或暂存，并收到系统/Bark 通知。

**Architecture:** 复用 app-server `item/tool/requestUserInput` 与现有回答 RPC。新增共用问题通知 tracker，按会话、回合、item 去重并保持隐藏来源静默；HTTP 收到服务器请求时也交给通知器。回答队列保留草稿，允许收起与重新打开。

**Tech Stack:** TypeScript、React、Vitest、Playwright、现有原生通知桥与 Ad Hoc OTA。

- [x] 运行审批与通知基线；在 `tests/ui/approval-requests.test.tsx` 写收起/恢复草稿用例，在 `tests/server/question-notifications.test.ts` 写重复请求、不同问题、隐藏会话及 catchup 用例，在 Bark HTTP/流式集成测试加入问题立即推送。
- [x] 执行定向测试确认失败；实现 `server/question-notifications.ts` 的 `observe(message, catchingUp)`、`rememberThread(thread)`，以 `[threadId, turnId, itemId ?? requestId]` 去重，有界保存且不保存回答或正文。
- [x] 执行定向测试确认失败后，给 `useApprovalRequests` 增加 `dismiss/reopen`；`ApprovalSheet` 增加“稍后回答”、会话标题、问题数量及多行输入；`App.tsx` 显示待回答入口并在 onRequest 发送通知，复用点击通知导航。
- [x] 在 `server/bark-notifications.ts` 接入问题 tracker，问题/完成使用不同去重命名空间；`server/http-session.ts` 收到待处理请求后提交通知观察，使用原有目的地址合并与持久去重。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/approval-requests.test.tsx tests/ui/approval-sheet.test.tsx tests/server/question-notifications.test.ts tests/server/bark-notifications.test.ts tests/server/http-session.test.ts tests/server/gateway.test.ts tests/ui/run-completion-notification.test.ts`；执行 `npm run build`、`npm run build:server` 与 `npm exec playwright test -- --config tests/e2e/approvals.config.ts`。
- [x] 更新 README；检查差异，按中文 Conventional Commits 提交，集成推送 main。持部署锁部署本次服务端模块并验证健康。
- [x] 持固定渠道锁分配高于双端现役的统一版本，构建发布 APK 与已签名 IPA，并检查 GitHub unsigned IPA 软件源版本；核对 JSON、HEAD、完整 GET 的大小与 SHA-256。
- [x] 保留包与发布凭证到长期工作区，清理临时文件，归档 worktree；协议模拟不创建真实测试会话。

## 开发验收

- 原有审批与通知基线 73 项通过。
- 新增用例先复现缺少提问推送、收起/恢复和多行输入；实现后 8 文件 150 项通过。
- 浏览器 3 项通过：失败保留回答与准确提交、审批待确认恢复、新提问通知与暂存多行草稿。
- 375px、大字号、横屏和减少动态效果截图已检查；应用沿用现有浅色主题，在系统深色偏好下仍可读。
- 客户端及服务端构建通过。仅使用协议模拟，不创建真实测试会话或向真实 Bark 地址发送测试通知。

## 发布验收

- 功能提交 `c98d047` 已推送 main；现役网关只部署本次三个模块，鉴权健康与 initialize/thread/list 只读检查通过。实际订阅的私有副本网络拦截验证，同一问题只产生一次推送，未触达真实 Bark 设备。
- Web 前端已部署；固定渠道持锁发布统一 `0.2.158` / build `2158`，GitHub Actions `38155659571` 双端与 Release 均成功。APK、unsigned IPA 来源提交、大小与完整散列与 GitHub digest 及回执一致。
- APK：4,721,063 字节；SHA-256 `d3b3cde8c62420e0d3850517e52513aa75b0fc57e487f0357d44f1319d73c96b`。
- Ad Hoc 已签名 IPA：3,789,956 字节；SHA-256 `d2e01cbfb4c2d8d574b7c26c18f96a446182e29eea60bc476d40e5b2e8fc18a4`。独立验签通过，安装身份与钥匙串组连续；签名包仅发布 OTA/LAN。
- 双端固定 JSON、HEAD、完整 GET 与本机产物一致，HTTPS OTA 清单及安装页通过回验。双端主前端 JS 散列一致，均包含本次提问 UI。
- 软件源普通/兼容入口已同步同版本 unsigned IPA，版本/build/URL/大小及 GitHub 完整散列证明通过，保留当前 GitHub 登录用户的原开发者署名。
- 证据保存在长期主工作区 `.mobile-build/model-questions-release/`；签名包、OTA 回执、APK、unsigned IPA、部署/软件源/固定渠道回验及截图均已保存。无真实测试会话需要归档；未执行真机覆盖安装与数据保留验证。
