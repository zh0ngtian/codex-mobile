import XCTest

/// 仅在显式传入本地网关地址时运行；配置不进入源码或测试附件。
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
        input.typeText("这是原生客户端验收测试。请只回复：" + marker + "。不要调用工具或修改文件。")
        let send = app.buttons["composer.submit"]
        XCTAssertTrue(send.isEnabled)
        send.tap()
        let response = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", marker)).firstMatch
        XCTAssertTrue(response.waitForExistence(timeout: 150), "应收到真实网关的模型回复")
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
