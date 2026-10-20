# 用户消息确认的模拟器传输夹具

此夹具仅绑定 `127.0.0.1:18839`，不连接真实网关、不创建远端会话。运行完整内置前端和原生界面，控制以下协议顺序：一次 `turn/start` 返回空 `items`，缺失用户消息事件，随后 `mobile/reset` 触发稀疏摘要与包含正式用户消息的过程回填。

```bash
node tests/fixtures/user-message-reconciliation/server.mjs
npm run ios:prepare -- --version 0.3.18
ruby scripts/configure-ios-tests.rb .mobile-build/ios/pakeplus/PakePlus.xcodeproj mobile/ios/UserMessageReconciliationUITests.swift
xcodebuild -project .mobile-build/ios/pakeplus/PakePlus.xcodeproj -scheme CodexMobileUITests -destination 'platform=iOS Simulator,id=<本任务独立模拟器>' -derivedDataPath .mobile-build/ios-derived-data -only-testing:CodexMobileUITests/UserMessageReconciliationUITests/testRecoveryAcknowledgesOneLocalBubbleAndPreservesRealRepeatedSend -parallel-testing-enabled NO -collect-test-diagnostics never test
```

生成测试 target 时第二个 Ruby 参数指定本用例。已有其他测试 target 的工程请先重新生成隔离工程，避免把旧 target 的来源当成新用例。正常发布不配置此 target，也不启动夹具。

验收断言包括：一次发送只出现一个用户气泡、回填确已触发且只发送一次、第二次真实发送相同正文保留两个气泡、重启重开数量一致。XCTest 截图位于 `.xcresult` 附件；`/__control/status` 仅提供合成数据与计数供验收。结束后关闭本夹具并释放本任务独立模拟器。

## 待确认引导的用户身份验收

`RECONCILIATION_PORT=18843 RECONCILIATION_STEERING=1 node tests/fixtures/user-message-reconciliation/server.mjs` 启用运行中回合和托管队列。用同样方式配置 `mobile/ios/PendingSteerMessageUITests.swift`，运行该类的两项测试。真实 App 入队并点击“改为引导”后，夹具保留请求，供界面观察待确认用户气泡；`/__control/confirm-steer` 返回带原 `clientId` 的正式用户项，`/__control/reject-steer` 返回明确失败。

验收等待确认、正式确认、完成及重启重开均只显示一条用户气泡，过程和助手正文不包含该引导；失败时临时气泡消失，原队列仍可操作。本模式同样仅绑定回环地址，不连接或创建真实会话。

## 占位身份、纯图片及仅回填的引导确认

```bash
RECONCILIATION_IDENTITY=1 node --import tsx tests/fixtures/user-message-reconciliation/server.mjs
APP_ID=vip.loock.codexmobile.identityqa npm run ios:prepare -- --version 0.3.20
ruby scripts/configure-ios-tests.rb .mobile-build/ios/pakeplus/PakePlus.xcodeproj mobile/ios/UserMessageReconciliationUITests.swift
```

在用户当前的iPhone17Pro模拟器中运行`UserMessageReconciliationUITests`。隔离模拟器包使用独立Bundle ID，保留正常App的设备配置和会话数据；只配置本机夹具，结束后归档合成会话、关闭夹具，再覆盖安装正常Bundle ID的修复构建并核对原会话。

身份模式直接复用生产`compactTurnCommentary`。`seed-alias`提供正式UUID摘要和`item-N`回填；`seed-image`仅包含可解码的合成图片；`seed-steer`开启队列，`confirm-steer-backfill`省略正式用户实时事件，只经reset后的回填恢复请求身份。四项界面用例覆盖占位回填、纯图片无空副本、回填引导确认及重开、一次发送1条与两次真实同文2条。归档控制为`/__control/archive`，所有数据都仅驻留本夹具内存。
