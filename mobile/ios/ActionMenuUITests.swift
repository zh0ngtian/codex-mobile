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
        let copy = action(app, "复制")
        XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.webViews.buttons["复制"].exists, "复制应由 UIKit 菜单呈现")
        let initialEdit = action(app, "编辑")
        XCTAssertTrue(initialEdit.exists && initialEdit.isHittable)
        XCTAssertGreaterThan(copy.frame.minY, initialEdit.frame.maxY - 1, "编辑与复制应直接纵向排列")
        attach(app, "消息纵向原生菜单")
        copy.tap()
        // 完成测试后通过 simctl pbpaste 回验系统剪贴板，避免测试 Runner 跨 App 粘贴弹窗阻塞。
        message.press(forDuration: 0.8)
        let edit = action(app, "编辑")
        XCTAssertTrue(edit.waitForExistence(timeout: 5), app.debugDescription)
        edit.tap()
        let editor = app.webViews.textViews["编辑历史消息内容"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(editor.value as? String, "原生菜单验收消息")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "原生菜单编辑应唤起键盘")
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
        XCTAssertTrue(action(app, "置顶").waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.webViews.menuItems["置顶"].exists)
        let labels = ["置顶", "刷新会话", "复制会话", "复制会话 ID", "重命名", "归档"]
        var previous: XCUIElement?
        for label in labels {
            let item = action(app, label)
            XCTAssertTrue(item.exists && item.isHittable, "所有操作应直接显示，无需二级展开：\(label)")
            if let previous { XCTAssertGreaterThan(item.frame.minY, previous.frame.maxY - 1, "会话操作应纵向排列") }
            previous = item
        }
        attach(app, "会话纵向原生菜单")
        action(app, "置顶").tap()
        XCTAssertTrue(app.webViews.staticTexts["会话已置顶"].waitForExistence(timeout: 5))
        open.tap()
        XCTAssertTrue(action(app, "取消置顶").waitForExistence(timeout: 5))
        action(app, "取消置顶").tap()
        XCTAssertTrue(app.webViews.staticTexts["会话未置顶"].waitForExistence(timeout: 5))
        open.tap()
        XCTAssertTrue(action(app, "归档").waitForExistence(timeout: 5))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.9)).tap()
        XCTAssertFalse(action(app, "归档").exists, "点击菜单外应关闭菜单")
        open.tap()
        XCTAssertTrue(action(app, "归档").waitForExistence(timeout: 5), "取消后仍可重新打开完整菜单")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.9)).tap()
    }

    private func action(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        let menuItem = app.menuItems[title]
        return menuItem.exists ? menuItem : app.buttons[title]
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
