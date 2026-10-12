# 当前运行回合的 commentary 恢复

执行：superpowers 计划与 TDD；独立 worktree 开发；完成后提交推送、部署网关及双端固定渠道发布。

目标：重新打开会话、重连、前台恢复或事件游标重置时，补齐当前仍运行且尚无 final_answer 的回合文本。保持摘要首屏，回填后台执行；常规轮询不重复触发。网关只回传文本，不传工具正文或 diff，不重新运行模型。

设计：新增只读 `mobile/turns/commentary`，上游仅读最近一个完整回合，严格核对 turnId、运行状态和 final。白名单投影 commentary 文本及用户文字锚点，HTTP/WS 共用。客户端按 ID 与已有文本合并，保留较长实时文本、用户附件和 final；守卫连接、会话打开代次，合并并发恢复请求。旧网关不支持时保留现有实时显示，不退回手机全量拉取。

- [ ] RED：网关过滤、传输、参数校验；客户端去重、文本竞态、用户插话锚点与最终回复。
- [ ] GREEN：投影、两种传输及客户端恢复入口；常规轮询不调用。
- [x] 浏览器验证重新打开、恢复事件和 final 到达；相关回归及客户端/服务端构建。
- [x] 提交推送、部署长期网关并验收；锁定版本、发布 APK 与签名 IPA；核对固定渠道和未签名软件源。
- [x] 记录验收、推送、保存产物并归档 worktree。

成本边界：网关到 app-server 仍会读取当前单回合 full，工具很多时该段成本仍高；手机只接收文字投影。历史统计与图片采用已有回填机制，不纳入 commentary 响应。

开发验证：相关网关/传输/恢复回归 133 项、额外消息合并与实时客户端回归 117 项通过（包括共同的 thread-session）。Chromium 与 WebKit mobile 的重新打开、网络恢复、迟到回填与 final、旧网关兼容共 6 项通过。构建通过。新增同 ID final 阶段竞态回归先失败，修复后通过。使用 mock 网关，没有新建真实测试会话。

交付验收：
- 功能提交 `bf4b864b54b536cd555fea1cab4a48bc5d9a7243` 已推送 main，长期主工作区已同步。网关已部署 0.2.160，鉴权健康与构建模块字节一致；真实运行回合探针回填 5 条 commentary，响应 2264 字节、本机 15 ms，无工具正文。这是单次样本，不代表所有长回合耗时。
- GitHub 工作流 `38198336507` 双端构建与 Release 成功；云端未签名 IPA 0.2.160 / 2160，3,766,930 字节，SHA-256 `c8e84eb494d0dad86f6c2a5864db1c8f0a781f59adb6abb6b23aa097ab6ee15d`。来源提交与 GitHub 全包散列一致；软件源普通、兼容清单均为此未签名包，开发者署名保持 zh0ngtian。
- APK 0.2.160：4,721,419 字节，SHA-256 `5c4e42b661e483078bc634dd0d2112c6c77ad866611c8672b836f45a1716fded`。
- Ad Hoc 已签名 IPA 0.2.160 / 2160：3,790,371 字节，SHA-256 `2699f5e0061cfa38cebc8b8bddba895e7941e0f6505650cf0178fdcd6f123da4`；Bundle ID、Team、application-identifier、钥匙串组与原身份保持连续。签名包仅 OTA/LAN。
- 固定 APK、IPA 与 HTTPS OTA 均已通过清单、HEAD、完整 GET 大小及散列核对；两个包都包含本次文本回填接口。固定 OTA 页版本核对通过。未验证真机覆盖安装或数据保留。
- 产物、构建回执、浏览器证据、网关探针及渠道验收保留在长期主工作区 `.mobile-build/commentary-backfill-release/0.2.160/`。仅使用 mock 浏览器测试，没有真实测试会话需要归档；本次 managed worktree 保存后归档。

固定交付入口：[OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[已签名 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)。
