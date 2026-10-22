# 桌面置顶双向同步界面验收

使用独立 iPhone 17 Pro、正常字号、竖屏与全新 App 数据；不要覆盖用户现有模拟器配置。

运行 `npx tsx tests/fixtures/desktop-pins/gateway.ts`，将输出的 `gateway` 和 `control` 分别通过测试运行器环境 `CODEX_TEST_GATEWAY`、`CODEX_TEST_PIN_CONTROL` 传给 `AgentAppUITests/testDesktopPinsSynchronizeBothDirections`。夹具使用真实网关与隔离 app-server 协议替身，不启动模型、不接触真实桌面会话；退出时删除临时状态。

测试验证桌面已有置顶显示为关注、手机取消回写、桌面再次置顶的前台自动同步、手机再次关注回写。服务端真实分组协议另外使用隔离 CODEX_HOME 核验；该 UI 夹具不等同于真机通知或生产部署验收。

本用例不验收首次添加设备。生成并配置 UI 测试宿主后，运行 `node tests/fixtures/desktop-pins/seed.mjs .mobile-build/ios/pakeplus/PakePlus/index.html '<gateway>'`，仅在这个隔离生成目录预置夹具设备，然后构建测试；勿将该测试首页复制到正式产物。结束后重新执行正常 `ios:prepare` 或移除生成的测试工程。
