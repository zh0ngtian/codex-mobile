import XCTest

/// 使用 tests/fixtures/native-menu 打包到专用模拟器测试工程；不写入真实会话。
final class ActionMenuUITests: XCTestCase {
    func testNativeMessageCopyAndEdit() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let message = app.webViews.staticTexts["原生菜单验收消息"]
        XCTAssertTrue(message.waitForExistence(timeout: 20), app.debugDescription)
        message.press(forDuration: 0.8)
        let copy = app.buttons["复制"]
        XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.webViews.buttons["复制"].exists, "复制应由 UIKit 菜单呈现")
        attach(app, "消息原生菜单")
        copy.tap()
        XCTAssertTrue(app.webViews.staticTexts["已复制"].waitForExistence(timeout: 5))
        message.press(forDuration: 0.8)
        let edit = app.buttons["编辑"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5), app.debugDescription)
        edit.tap()
        let editor = app.webViews.textViews["编辑历史消息内容"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(editor.value as? String, "原生菜单验收消息")
        attach(app, "原位置消息编辑")
        app.webViews.buttons["取消编辑历史消息"].tap()
    }

    func testNativeThreadMenuSelectAndReopen() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let open = app.webViews.buttons["打开会话菜单验收"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        XCTAssertTrue(app.buttons["置顶"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.webViews.buttons["置顶"].exists)
        attach(app, "会话原生菜单")
        app.buttons["置顶"].tap()
        XCTAssertTrue(app.webViews.staticTexts["会话已置顶"].waitForExistence(timeout: 5))
        open.tap()
        XCTAssertTrue(app.buttons["取消置顶"].waitForExistence(timeout: 5))
        app.buttons["取消置顶"].tap()
        XCTAssertTrue(app.webViews.staticTexts["会话未置顶"].waitForExistence(timeout: 5))
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
