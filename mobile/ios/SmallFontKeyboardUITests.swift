import XCTest

final class SmallFontKeyboardUITests: XCTestCase {
    private func viewport(_ app: XCUIApplication) throws -> [String: Any] {
        let probe = app.staticTexts["codex.viewport-state"]
        XCTAssertTrue(probe.waitForExistence(timeout: 5))
        let data = try XCTUnwrap(probe.label.data(using: .utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func selectFont(_ title: String, in app: XCUIApplication) {
        let manage = app.webViews.buttons["管理设备"]
        XCTAssertTrue(manage.waitForExistence(timeout: 20))
        manage.tap()
        let choice = app.webViews.descendants(matching: .any).matching(identifier: title).firstMatch
        if !choice.waitForExistence(timeout: 3) {
            // 网关启动恢复完成时可能重置刚打开的设置页，初始化后再打开。
            XCTAssertTrue(manage.waitForExistence(timeout: 10))
            manage.tap()
        }
        XCTAssertTrue(choice.waitForExistence(timeout: 5), app.debugDescription)
        if !choice.isHittable { app.swipeUp() }
        choice.tap()
        app.webViews.buttons["关闭"].tap()
    }

    func testSmallFontSendingKeepsComposerVisibleDuringDismissal() throws {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "发送通知授权") { alert in
            for title in ["不允许", "Don’t Allow"] {
                if alert.buttons[title].exists { alert.buttons[title].tap(); return true }
            }
            return false
        }
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        if !app.webViews.buttons["管理设备"].waitForExistence(timeout: 3) {
            let add = app.webViews.buttons["添加设备"]
            if add.exists { add.tap() }
            let address = app.webViews.textFields["网关地址"]
            XCTAssertTrue(address.waitForExistence(timeout: 15), app.debugDescription)
            let name = app.webViews.textFields["设备名称"]
            name.tap()
            name.typeText("Small Font Simulator")
            address.tap()
            address.typeText("http://127.0.0.1:18786/?token=ios-simulator-check")
            app.webViews.buttons["测试并保存"].tap()
            XCTAssertTrue(app.webViews.buttons["管理设备"].waitForExistence(timeout: 30))
        }
        selectFont("小", in: app)
        app.terminate()
        app.launch()
        let chat = app.webViews.buttons["聊天"]
        XCTAssertTrue(chat.waitForExistence(timeout: 20))
        chat.tap()
        let input = app.webViews.textViews["向 Codex 提问"]
        if !input.waitForExistence(timeout: 3) { chat.tap() }
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        for attempt in 1...3 {
            input.tap()
            input.typeText("请只回复 IOS_SMALL_FONT_OK_\(attempt)，不调用工具，不修改文件。")
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
            let focused = try viewport(app)
            print("SMALL_FONT_FOCUSED \(focused)")
            XCTAssertEqual(focused["font"] as? String, "14px", "复现必须使用实际的小字体")
            XCTAssertTrue(app.webViews.buttons["发送"].isHittable)
            let before = XCTAttachment(screenshot: app.screenshot())
            before.name = "小字体发送前"
            before.lifetime = .keepAlways
            add(before)
            app.webViews.buttons["发送"].tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            let dismissed = try viewport(app)
            print("SMALL_FONT_DISMISSED \(dismissed)")
            XCTAssertEqual(try XCTUnwrap(focused["scale"] as? Double), 1, accuracy: 0.01,
                           "小字体聚焦不应触发 WebKit 自动放大")
            XCTAssertEqual(try XCTUnwrap(dismissed["scale"] as? Double), 1, accuracy: 0.01,
                           "发送收起键盘不应触发页面缩放")
            XCTAssertEqual(app.staticTexts["codex.geometry-animation-count"].label, "0")
            XCTAssertEqual(app.staticTexts["codex.scroll-geometry-animation-count"].label, "0")
            let step = app.staticTexts["codex.composer-maximum-frame-step"]
            XCTAssertTrue(step.waitForExistence(timeout: 5))
            print("SMALL_FONT_COMPOSER_FRAME_STEP \(step.label)")
            XCTAssertLessThan(try XCTUnwrap(Double(step.label)), 100,
                              "键盘仍在收起时输入框不应一帧跳到屏幕底部并被遮住")
            let frame = input.frame
            for _ in 0..<12 {
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
                XCTAssertEqual(input.frame.minY, frame.minY, accuracy: 1)
            }
            XCTAssertTrue(app.webViews.staticTexts["IOS_SMALL_FONT_OK_\(attempt)"].waitForExistence(timeout: 90))
        }
        input.tap()
        input.typeText("小字体下一条草稿")
        XCTAssertEqual(input.value as? String, "小字体下一条草稿")
        let done = app.toolbars.buttons["Done"]
        if done.exists { done.tap() } else { app.toolbars.buttons["完成"].tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        XCTAssertLessThan(try XCTUnwrap(Double(app.staticTexts["codex.composer-maximum-frame-step"].label)), 100)
        XCTAssertEqual(input.value as? String, "小字体下一条草稿")
        app.webViews.buttons["打开会话列表"].tap()
        selectFont("标准", in: app)
    }
}
