import XCTest

/// 独立界面夹具及本地网关验收；连接凭证不进入源码或测试附件。
@MainActor
final class AgentAppUITests: XCTestCase {
    func testAgentAppControlsAreAccessible() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 12), app.debugDescription)
        XCTAssertFalse(app.buttons["管理设备"].exists, "隐藏的网页业务层不应暴露交互节点")
    }

    func testAgentAppSidebarControlsAreAccessible() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 12))
        app.buttons["会话列表"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["sidebar.codexMenu"].waitForExistence(timeout: 8), app.debugDescription)
    }

    private func launchConversationFixture(long: Bool = false, resetContext: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if long { app.launchArguments.append("--agent-conversation-long-fixture") }
        if resetContext { app.launchArguments.append("--agent-conversation-reset-context") }
        app.launch()
        XCTAssertTrue(app.staticTexts["history-request-count"].waitForExistence(timeout: 8))
        return app
    }

    func testConversationUsesReferenceHistoryComponentAndTrimmedUserText() {
        let app = launchConversationFixture()
        let question = app.staticTexts["请检查项目上下文。"]
        XCTAssertTrue(question.waitForExistence(timeout: 8))
        XCTAssertLessThan(question.frame.height, 30, "尾部空白行不应增加用户文字高度")
        XCTAssertFalse(app.buttons["history.loadEarlier"].exists)
        XCTAssertTrue(app.buttons["commentary-history-toggle"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["正在读取项目上下文。"].exists)
        captureConversation("历史过程-折叠", app: app)
        app.buttons["commentary-history-toggle"].tap()
        XCTAssertTrue(app.staticTexts["正在读取项目上下文。"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["已检查相关文件，正在整理结果。"].exists)
        XCTAssertTrue(app.staticTexts["10:44"].exists)
        XCTAssertTrue(app.staticTexts["10:45"].exists)
        captureConversation("历史过程-展开", app: app)
        app.buttons["commentary-history-toggle"].tap()
        XCTAssertFalse(app.staticTexts["正在读取项目上下文。"].exists)
    }

    func testHistoryRequiresAnotherPullAndPreservesReadingAnchor() {
        let app = launchConversationFixture(long: true)
        let timeline = app.scrollViews["conversation.timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))
        let counter = app.staticTexts["history-request-count"]
        XCTAssertEqual(counter.label, "0", "初始布局不加载")
        let question = app.staticTexts["请检查项目上下文。"]
        let header = app.buttons["header.usage"]
        let headerY = header.frame.minY
        let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        XCTAssertEqual(counter.label, "0", "第一次到顶及同一手势下拉不加载")
        let priorY = question.frame.minY
        captureConversation("首次下拉-未加载", app: app)
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        expectation(for: NSPredicate(format: "label == '1'"), evaluatedWith: counter)
        waitForExpectations(timeout: 8)
        XCTAssertTrue(question.isHittable)
        expectation(for: NSPredicate { _, _ in abs(question.frame.minY - priorY) < 35 }, evaluatedWith: question)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(question.frame.minY, priorY, accuracy: 35, "前插历史后应保留原阅读位置")
        captureConversation("二次下拉-阅读锚点", app: app)
        XCTAssertTrue(header.isHittable)
        XCTAssertEqual(header.frame.minY, headerY, accuracy: 1, "加载历史不应移动固定页头")
        XCTAssertEqual(question.frame.minY, priorY, accuracy: 35, "最终布局应保持阅读位置")
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        XCTAssertEqual(counter.label, "1", "没有更多历史不重复加载")
    }

    private func captureConversation(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testReopeningSameConversationReleasesHistoryRequest() {
        let app = launchConversationFixture(long: true, resetContext: true)
        let timeline = app.scrollViews["conversation.timeline"]
        let counter = app.staticTexts["history-request-count"]
        let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        func pull() { from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1) }
        pull(); pull()
        XCTAssertEqual(counter.label, "1")
        pull(); pull()
        expectation(for: NSPredicate(format: "label == '2'"), evaluatedWith: counter)
        waitForExpectations(timeout: 8)
        XCTAssertFalse(app.progressIndicators["正在加载历史消息"].exists)
    }

    private func launchConnectedApp() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let gateway = ProcessInfo.processInfo.environment["CODEX_TEST_GATEWAY"]
            ?? ProcessInfo.processInfo.environment["TEST_RUNNER_CODEX_TEST_GATEWAY"]
        let name = "验收 Mac"
        func any(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
        let addressField = any("device.address")
        if !addressField.waitForExistence(timeout: 3) {
            XCTAssertTrue(any("header.usage").waitForExistence(timeout: 12))
            if !any("sidebar.codexMenu").exists { app.buttons["会话列表"].tap() }
            XCTAssertTrue(any("sidebar.codexMenu").waitForExistence(timeout: 8))
            any("sidebar.codexMenu").tap()
            app.buttons["设置"].tap()
            XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 8))
            app.staticTexts["设备"].tap()
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 8))
            if !app.staticTexts[name].exists {
                guard gateway != nil else { throw XCTSkip("需要显式配置本地验收网关") }
                any("devices.add").tap()
            }
        }
        if addressField.exists {
            guard let gateway, !gateway.isEmpty else { throw XCTSkip("需要显式配置本地验收网关") }
            let nameField = any("device.name")
            nameField.tap(); nameField.typeText(name)
            addressField.tap(); addressField.typeText(gateway)
            any("device.testAndSave").tap()
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 35))
        }
        if any("settings.close").exists { any("settings.close").tap() }
        if app.buttons["完成设备设置"].exists { app.buttons["完成设备设置"].tap() }
        if !any("sidebar.codexMenu").exists, app.buttons["会话列表"].exists { app.buttons["会话列表"].tap() }
        XCTAssertTrue(any("sidebar.codexMenu").waitForExistence(timeout: 15))
        any("sidebar.codexMenu").tap()
        let target = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10))
        target.tap()
        XCTAssertTrue(any("sidebar.askCodex").waitForExistence(timeout: 12))
        return app
    }

    func testConfigureProvidedGateway() throws {
        let app = try launchConnectedApp()
        XCTAssertTrue(app.staticTexts["验收 Mac"].exists)
    }

    func testLiveMessageRoundTripAndArchive() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.askCodex"].tap()
        let input = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        input.tap()
        let marker = "AGENTUI-" + String(UUID().uuidString.prefix(8))
        input.typeText("这是原生客户端验收测试。请先发送一条简短执行进展，再调用工具查询当前工作目录，最后只回复：" + marker + "。只读验证，不要修改文件。")
        let send = app.buttons["composer.submit"]
        XCTAssertTrue(send.isEnabled)
        send.tap()
        let response = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", marker)).firstMatch
        XCTAssertTrue(response.waitForExistence(timeout: 150), "应收到真实网关的模型回复")
        let history = app.buttons["commentary-history-toggle"].firstMatch
        XCTAssertTrue(history.waitForExistence(timeout: 8), "真实执行进展应进入参考历史组件")
        history.tap()
        captureConversation("真实网关-执行过程", app: app)
        app.buttons["header.usage"].tap()
        XCTAssertTrue(app.staticTexts["上下文余量"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["周期剩余"].exists)
        XCTAssertTrue(app.staticTexts["输入 Token"].exists)
        app.buttons["header.usage"].tap()
        app.buttons["conversation.actions"].tap()
        app.buttons["归档"].tap()
        XCTAssertTrue(app.buttons["sidebar.askCodex"].waitForExistence(timeout: 20))
    }

    func testAgentAppSidebarSearchAndSettings() throws {
        let app = try launchConnectedApp()
        let sidebar = app.otherElements["sidebar.panel"]
        if sidebar.exists {
            XCTAssertEqual(sidebar.frame.width / app.frame.width, 0.8, accuracy: 0.035)
        }
        app.buttons["sidebar.search"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["sidebar.search"].tap()
        app.buttons["sidebar.codexMenu"].tap()
        app.buttons["设置"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["设备"].exists || app.staticTexts["设备"].exists)
        XCTAssertTrue(app.buttons["通知"].exists || app.staticTexts["通知"].exists)
    }

    func testKeepNativeInterfaceEnabledForAcceptance() throws {
        let app = try launchConnectedApp()
        app.descendants(matching: .any)["sidebar.codexMenu"].tap()
        app.buttons["设置"].tap()
        let toggle = app.switches["native-ui-preference"]
        for _ in 0..<3 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 8))
        if toggle.value as? String == "0" { toggle.tap() }
        let enabled = NSPredicate(format: "value == '1'")
        expectation(for: enabled, evaluatedWith: toggle)
        waitForExpectations(timeout: 12)
        app.buttons["settings.close"].tap()
    }
}
