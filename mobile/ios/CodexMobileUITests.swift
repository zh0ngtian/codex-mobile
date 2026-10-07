import XCTest

final class CodexMobileUITests: XCTestCase {
    func testEmbeddedFrontendAndGatewayConnection() throws {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "系统通知授权") { alert in
            let deny = alert.buttons["不允许"]
            if deny.exists { deny.tap(); return true }
            let denyEnglish = alert.buttons["Don’t Allow"]
            if denyEnglish.exists { denyEnglish.tap(); return true }
            return false
        }
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        if !app.webViews.buttons["管理设备"].waitForExistence(timeout: 3) {
            let address = app.webViews.textFields["网关地址"]
            XCTAssertTrue(address.waitForExistence(timeout: 20), app.debugDescription)
            let name = app.webViews.textFields["设备名称"]
            name.tap()
            name.typeText("iOS Simulator")
            let keyboardImage = XCTAttachment(screenshot: app.screenshot())
            keyboardImage.lifetime = .keepAlways
            add(keyboardImage)
            address.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
            address.typeText("http://127.0.0.1:18786/?token=wrong")
            app.webViews.buttons["测试并保存"].tap()
            XCTAssertTrue(app.webViews.staticTexts["访问口令不正确"].waitForExistence(timeout: 15), app.debugDescription)
            app.webViews.buttons["取消"].tap()
            app.webViews.buttons["添加设备"].tap()
            name.tap()
            name.typeText("iOS Simulator")
            address.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
            address.typeText("http://127.0.0.1:18786/?token=ios-simulator-check")
            app.webViews.buttons["测试并保存"].tap()
            XCTAssertTrue(app.webViews.buttons["管理设备"].waitForExistence(timeout: 30), app.debugDescription)
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "iOS 网关连接成功"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.webViews.buttons["管理设备"].waitForExistence(timeout: 20), app.debugDescription)
        app.webViews.buttons["聊天"].tap()
        let input = app.webViews.textViews["向 Codex 提问"]
        XCTAssertTrue(input.waitForExistence(timeout: 15), app.debugDescription)
        let settings = app.webViews.buttons["选择模型、智能与速度"]
        settings.tap()
        let medium = app.webViews.switches.containing(NSPredicate(format: "label BEGINSWITH %@", "中")).firstMatch
        XCTAssertTrue(medium.waitForExistence(timeout: 10), app.debugDescription)
        medium.tap()
        XCTAssertTrue(settings.label.contains("选择模型"))
        input.tap()
        input.typeText("这是 iOS 模拟器自动化验证。请只回复 IOS_SIMULATOR_OK，不调用工具，不修改文件。")
        XCTAssertTrue(app.webViews.buttons["发送"].isHittable, "键盘弹出时发送按钮应可操作")
        app.webViews.buttons["发送"].tap()
        XCTAssertTrue(app.webViews.staticTexts["IOS_SIMULATOR_OK"].waitForExistence(timeout: 90), app.debugDescription)
        if app.alerts.buttons["不允许"].exists { app.alerts.buttons["不允许"].tap() }
        let resultImage = XCTAttachment(screenshot: app.screenshot())
        resultImage.name = "iOS 消息往返成功"
        resultImage.lifetime = .keepAlways
        add(resultImage)
    }
}
