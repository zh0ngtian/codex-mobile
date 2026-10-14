# 已完成回合的 commentary 历史恢复

执行：superpowers 计划、TDD 与发布前验证；用户已确认修复并重新发布。登记客户端和网关两个目标，ready 同一固定 SHA，等待两份成功凭证后交付。

根因证据：0.2.170 的真实已完成回合 full 有8条 commentary，summary和现役 details均为0条；按钮只统计 commentary，因此重新打开后消失。

设计：复用 `mobile/turns/details` 的现有 full 读取，添加仅含 id/type/phase/text 的 commentaryItems，以及用户/助手消息ID顺序 messageOrder（final只返回ID锚点，不重复传正文）。客户端原有统计/图片回填解析并按ID恢复过程说明，以顺序锚点保持用户插话、final与实时文本。保留浅灰线与默认折叠。流式旧 full 响应直接从 items 提取同样内容；不新增完整历史请求，不改变运行专用 commentary 接口。

- [x] RED：网关结束回合投影保留 commentary，7MB工具正文不下发；客户端完成摘要恢复、未知统计、插话与多个 final、较长实时文本、重复回填。
- [x] GREEN：`server/turn-details.ts` 白名单投影，`src/app-server/thread-session.ts` 解析与合并，不改现有加载入口。
- [x] 浏览器用真实摘要/详情分离数据验证重新打开、刷新、历史分页、默认折叠、展开后工具过滤与浅灰线。
- [x] 相关测试、客户端/服务端构建、适配器/协调恢复/契约/类型检查。
- [ ] 固定分支提交推送；同SHA分别ready网关和客户端，经协调器部署与统一双端发布。
- [ ] 核对实际历史回填及两个成功receipt、固定清单HEAD完整GET、OTA和软件源中文更新日志，保存证据并归档worktree。

文件：`server/turn-details.ts`、`src/app-server/thread-session.ts`、`tests/server/turn-details.test.ts`、`tests/server/http-session.test.ts`、`tests/ui/thread-session.test.ts`；新增 `tests/e2e/commentary-history.spec.ts` 与 config。

开发验收：回填/传输78项、额外对话/实时/HTTP/WS137项通过；历史重新打开/刷新/分页 Chromium 与 WebKit mobile 4项通过。客户端与服务端构建通过，保留既有大chunk警告。适配器153、协调恢复30、构建契约82及类型检查通过。全部使用 mock/fixture，无真实测试会话。
