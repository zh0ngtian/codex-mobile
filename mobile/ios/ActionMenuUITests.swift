import XCTest

/// 使用 tests/fixtures/native-menu 打包到专用模拟器测试工程；不写入真实会话。
final class ActionMenuUITests: XCTestCase {
    func testHistoryEditorShowsKeyboardAndScrollsAboveComposer() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let entry = app.webViews.buttons["打开历史编辑定位验收"]
        XCTAssertTrue(entry.waitForExistence(timeout: 20))
        entry.tap()
        let message = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "键盘滚动定位验收消息")).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        for nativeMenu in [false, true] {
            if nativeMenu {
                message.press(forDuration: 0.8)
                let edit = action(app, "编辑")
                XCTAssertTrue(edit.waitForExistence(timeout: 5))
                edit.tap()
            } else {
                app.webViews.buttons["编辑历史消息"].tap()
            }
            let editor = app.webViews.textViews["编辑历史消息内容"]
            XCTAssertTrue(editor.waitForExistence(timeout: 5))
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "进入编辑应自动弹出键盘")
            let composer = app.webViews.buttons["模型验收"]
            let visible = NSPredicate { _, _ in
                editor.frame.height > 0 && editor.frame.minY >= app.webViews.firstMatch.frame.minY &&
                editor.frame.maxY <= min(composer.frame.minY - 12, app.keyboards.firstMatch.frame.minY - 12)
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: visible, object: editor)], timeout: 5), .completed,
                "编辑框应自动滚动到固定输入栏与键盘以上：\(editor.frame), composer: \(composer.frame)")
            attach(app, nativeMenu ? "长按编辑自动键盘与定位" : "按钮编辑自动键盘与定位")
            let viewportProbe = app.staticTexts["codex.viewport-state"]
            let caretVisible = NSPredicate { _, _ in
                guard let data = viewportProbe.label.data(using: .utf8),
                      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
                return value["historyCaretVisible"] as? Bool == true
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: caretVisible, object: viewportProbe)], timeout: 5), .completed,
                "多行编辑框缩小后仍应显示原文末尾的光标")
            editor.typeText("OK")
            XCTAssertTrue((editor.value as? String)?.contains("OK") == true)
            app.webViews.buttons["取消编辑历史消息"].tap()
            XCTAssertFalse(editor.exists)
        }
    }

    func testSidebarMenuCancelThenTapOpensThread() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let sidebar = app.webViews.buttons["打开侧栏验收"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 20))
        sidebar.tap()
        let row = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "取消菜单后进入会话")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        row.press(forDuration: 0.8)
        XCTAssertTrue(action(app, "归档").waitForExistence(timeout: 5), app.debugDescription)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.9)).tap()
        XCTAssertFalse(action(app, "归档").exists)
        attach(app, "侧栏长按菜单取消")
        row.tap()
        XCTAssertTrue(app.webViews.staticTexts["已进入侧栏会话"].waitForExistence(timeout: 5), "取消菜单后单击必须进入会话：\(app.debugDescription)")
        XCTAssertFalse(action(app, "归档").exists, "普通点击不能重新打开原生菜单")
        sidebar.tap()
        row.press(forDuration: 0.8)
        XCTAssertTrue(action(app, "置顶").waitForExistence(timeout: 5))
        action(app, "置顶").tap()
        row.tap()
        XCTAssertTrue(app.webViews.staticTexts["已进入侧栏会话"].waitForExistence(timeout: 5))
        XCTAssertFalse(action(app, "归档").exists)
        attach(app, "取消后单击进入会话")
    }

    func testSidebarTapDuringMenuDismissalOpensThread() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let sidebar = app.webViews.buttons["打开侧栏验收"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 20))
        sidebar.tap()
        let row = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "取消菜单后进入会话")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let center = row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        row.press(forDuration: 0.8)
        XCTAssertTrue(action(app, "归档").waitForExistence(timeout: 5))
        // 第一击取消菜单，紧接着第二击应交给会话行，不应重开临时宿主菜单。
        center.doubleTap()
        XCTAssertTrue(app.webViews.staticTexts["已进入侧栏会话"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(action(app, "归档").exists)
        attach(app, "菜单取消动画期间单击")
    }

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

    func testSkillPickerTouchSelection() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let open = app.webViews.buttons["打开 Skill 选择验收"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        let input = app.webViews.textViews["向 Codex 提问"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("@pdf")
        let option = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "$pdf")).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5), app.debugDescription)
        option.tap()
        XCTAssertEqual(input.value as? String, "$pdf ", "触摸候选必须写入 Skill 标记")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), "选择 Skill 后应继续输入")
        attach(app, "Skill 触摸选择")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5) + "@")
        let list = app.webViews.otherElements["已安装 Skill 和插件"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        for _ in 0..<3 {
            // AX 列表 frame 包含不可见内容，swipeUp 会被裁成点击；在可见区域拖动。
            let start = app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: input.frame.midX, dy: input.frame.minY - 70))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -180)))
            attach(app, "候选滚动状态")
            XCTAssertEqual(input.value as? String, "@", "滚动候选不能触发选择")
            XCTAssertTrue(list.exists, "滚动后候选应保持显示：\(app.debugDescription)")
        }
        XCTAssertEqual(input.value as? String, "@", "滚动候选不能触发选择")
        let last = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "$skill-7")).firstMatch
        XCTAssertTrue(last.exists && last.isHittable)
        last.tap()
        XCTAssertEqual(input.value as? String, "$skill-7 ")
        attach(app, "滚动后选择 Skill")
    }

    func testThreadMenuOrderStaysFixedAcrossPinAndAnchor() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let open = app.webViews.buttons["打开菜单顺序验收"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        for pinned in [false, true] {
            open.tap()
            let pinLabel = pinned ? "取消置顶" : "置顶"
            XCTAssertTrue(action(app, pinLabel).waitForExistence(timeout: 5))
            let labels = [pinLabel, "刷新会话", "复制会话", "复制会话 ID", "重命名", "归档"]
            var previous: XCUIElement?
            for label in labels {
                let item = action(app, label)
                XCTAssertTrue(item.exists && item.isHittable, label)
                if let previous {
                    XCTAssertGreaterThan(item.frame.minY, previous.frame.maxY - 1,
                        "置顶前后和上下弹出位置都必须保持相同顺序：\(label)")
                }
                previous = item
            }
            attach(app, pinned ? "置顶后菜单顺序" : "置顶前菜单顺序")
            action(app, pinLabel).tap()
            XCTAssertTrue(app.webViews.staticTexts[pinned ? "会话未置顶" : "会话已置顶"].waitForExistence(timeout: 5))
        }
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
