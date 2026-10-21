import XCTest

/// 系统长按菜单、生产NativeSelectableText与生产Composer卡片的回归；live用例另走真实网关。
@MainActor final class SelectionQuoteUITests: XCTestCase {
    private func any(_ id: String, in app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func capture(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func fixture() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-selection-quotes-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch(); XCTAssertTrue(app.buttons["conversation.actions"].waitForExistence(timeout: 10)); return app
    }
    private func select(_ text: XCUIElement, app: XCUIApplication, x: CGFloat = 0.15, y: CGFloat = 0.2, expectedMenu: String = "加入聊天") {
        XCTAssertTrue(text.waitForExistence(timeout: 10), app.debugDescription)
        for _ in 0..<5 { if text.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(text.isHittable, app.debugDescription)
        text.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).press(forDuration: 1.2)
        if text.identifier == "user.selectable" {
            XCTAssertTrue(app.buttons["选择文本"].waitForExistence(timeout: 5), app.debugDescription)
            app.buttons["选择文本"].tap()
        }
        XCTAssertTrue(app.menuItems[expectedMenu].waitForExistence(timeout: 5), app.debugDescription)
    }
    func testBodySelectionAppendsCardsPreservesDraftAndAttachment() {
        let app = fixture()
        let body = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value BEGINSWITH %@", "assistant.selectable", "这段文字")).firstMatch
        select(body, app: app)
        XCTAssertTrue(app.menuItems["在 Sidechat 中提问"].exists)
        capture("系统选文菜单-两个业务动作", app: app)
        app.menuItems["加入聊天"].tap()
        XCTAssertTrue(any("composer.quote", in: app).waitForExistence(timeout: 8))
        XCTAssertEqual(any("message-input", in: app).value as? String, "已有问题")
        XCTAssertTrue(app.staticTexts["example.txt"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "收到业务快照后才聚焦输入栏")
        any("quote.expand", in: app).tap(); capture("引用卡片-展开及保留输入附件", app: app)
        let timeline = any("conversation.timeline", in: app)
        let start = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
        let finish = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.05, thenDragTo: finish, withVelocity: .slow, thenHoldForDuration: 0.1)
        let hiddenKeyboard = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [hiddenKeyboard], timeout: 5), .completed, "先通过真实滚动收起键盘，再选择第二段可见文字")
        let secondParagraph = body.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "第二段")).firstMatch
        XCTAssertTrue(secondParagraph.waitForExistence(timeout: 5))
        secondParagraph.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        capture("第二段单击返回阅读后", app: app)
        select(secondParagraph, app: app, x: 0.2, y: 0.5)
        capture("第二段真实系统选文菜单", app: app)
        app.menuItems["加入聊天"].tap()
        let cards = app.descendants(matching: .any).matching(identifier: "composer.quote")
        let appended = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in cards.count == 2 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [appended], timeout: 8), .completed)
        XCTAssertEqual(any("message-input", in: app).value as? String, "已有问题")
        any("quote.remove", in: app).tap()
        XCTAssertEqual(cards.count, 1)
        XCTAssertTrue(app.staticTexts["example.txt"].exists)
        any("quote.remove", in: app).tap()
        XCTAssertFalse(any("composer.quote", in: app).exists)
        XCTAssertEqual(any("message-input", in: app).value as? String, "已有问题")
    }
    func testSelectionPreparesSidechatWithoutSendingAndReturnsDraft() {
        let app = fixture()
        let body = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value BEGINSWITH %@", "assistant.selectable", "这段文字")).firstMatch
        select(body, app: app); app.menuItems["在 Sidechat 中提问"].tap()
        XCTAssertTrue(app.buttons["sidechat.return"].waitForExistence(timeout: 10))
        XCTAssertTrue(any("composer.quote", in: app).exists)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "跨会话引用快照确认后聚焦Sidechat输入栏")
        XCTAssertFalse(app.buttons["composer.submit"].isEnabled, "只有引用时不能自动发送")
        XCTAssertFalse(app.staticTexts["example.txt"].exists)
        capture("选文Sidechat-待提问", app: app)
        app.buttons["sidechat.return"].tap()
        XCTAssertEqual(any("message-input", in: app).value as? String, "已有问题")
        XCTAssertTrue(app.staticTexts["example.txt"].exists)
    }
    func testUserAndExpandedCommentarySelectionMenus() {
        var app = fixture()
        select(app.textViews["user.selectable"].firstMatch, app: app, x: 0.3, y: 0.5)
        app.menuItems["加入聊天"].tap(); XCTAssertTrue(any("composer.quote", in: app).waitForExistence(timeout: 5))
        app.terminate(); app = fixture()
        app.buttons["commentary-history-toggle"].tap()
        select(app.textViews["commentary.selectable"].firstMatch, app: app, x: 0.3, y: 0.5)
        app.menuItems["加入聊天"].tap(); XCTAssertTrue(any("composer.quote", in: app).waitForExistence(timeout: 5))
        capture("执行过程选文引用", app: app)
    }
    func testCodeAndTableSelectionMenus() {
        var app = fixture()
        app.buttons["会话列表"].tap()
        app.buttons["sidebar.more"].tap()
        app.collectionViews.buttons["设置"].tap()
        let wrapToggle = app.switches["settings.code-wrap"]
        XCTAssertTrue(wrapToggle.waitForExistence(timeout: 5))
        if !wrapToggle.isHittable { app.swipeUp() }
        if wrapToggle.value as? String == "1" {
            wrapToggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        }
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "0"), object: wrapToggle)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
        app.buttons["settings.close"].tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.3)).tap()
        select(app.textViews["code.selectable"].firstMatch, app: app, x: 0.25, y: 0.5)
        app.menuItems["加入聊天"].tap(); XCTAssertTrue(any("composer.quote", in: app).waitForExistence(timeout: 5))
        app.terminate(); app = fixture()
        select(app.textViews.matching(NSPredicate(format: "identifier == %@ AND value == %@", "markdown.selectable", "引用")).firstMatch, app: app, x: 0.5, y: 0.5)
        app.menuItems["加入聊天"].tap(); XCTAssertTrue(any("composer.quote", in: app).waitForExistence(timeout: 5))
        capture("表格单元格选文引用", app: app)
    }
    func testLiveSelectionAsksInSidechatAndClosesBranch() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let title = env["CODEX_SELECTION_MAIN_TITLE"] ?? env["TEST_RUNNER_CODEX_SELECTION_MAIN_TITLE"] else { throw XCTSkip("需指定专用测试主聊天标题及CODEX_TEST_GATEWAY") }
        let gateway = env["CODEX_TEST_GATEWAY"] ?? env["TEST_RUNNER_CODEX_TEST_GATEWAY"]
        let deviceName = env["CODEX_SELECTION_DEVICE_NAME"] ?? env["TEST_RUNNER_CODEX_SELECTION_DEVICE_NAME"] ?? "选文引用验收"
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-live", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]; app.launch()
        let address = any("device.address", in: app)
        if address.waitForExistence(timeout: 3) {
            guard let gateway else { throw XCTSkip("首次设备配置需要CODEX_TEST_GATEWAY") }
            let name = any("device.name", in: app); name.tap(); name.typeText(deviceName)
            address.tap(); address.typeText(gateway); any("device.testAndSave", in: app).tap()
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 35))
            if any("settings.close", in: app).exists { any("settings.close", in: app).tap() }
            if app.buttons["完成设备设置"].exists { app.buttons["完成设备设置"].tap() }
        }
        let scope = app.buttons["sidebar.more"]
        if !scope.isHittable { app.buttons["会话列表"].tap() }
        XCTAssertTrue(scope.waitForExistence(timeout: 20))
        if scope.value as? String != deviceName {
            scope.tap()
            let scopeMenu = app.collectionViews.containing(.button, identifier: "设置").firstMatch
            XCTAssertTrue(scopeMenu.waitForExistence(timeout: 8), app.debugDescription)
            let target = scopeMenu.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", deviceName)).firstMatch
            if target.waitForExistence(timeout: 3) { target.tap() }
            else {
                guard let gateway else { throw XCTSkip("添加专用测试设备需要CODEX_TEST_GATEWAY") }
                let settings = scopeMenu.buttons.matching(NSPredicate(format: "label == %@", "设置")).firstMatch
                XCTAssertTrue(settings.waitForExistence(timeout: 8), app.debugDescription)
                let settingsVisible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: settings)
                XCTAssertEqual(XCTWaiter.wait(for: [settingsVisible], timeout: 5), .completed, "只点击原生菜单中可见的设置项")
                settings.tap()
                let form = any("settings.form", in: app)
                XCTAssertTrue(form.waitForExistence(timeout: 8))
                let devices = form.buttons.matching(NSPredicate(format: "label BEGINSWITH '设备'")).firstMatch
                XCTAssertTrue(devices.waitForExistence(timeout: 8)); devices.tap()
                XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 8))
                let add = app.buttons["devices.add"]
                let list = app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
                for _ in 0..<8 { if add.isHittable { break }; list.swipeUp() }
                XCTAssertTrue(add.isHittable); add.tap()
                let name = any("device.name", in: app); XCTAssertTrue(name.waitForExistence(timeout: 8)); name.tap(); name.typeText(deviceName)
                let newAddress = any("device.address", in: app); newAddress.tap(); newAddress.typeText(gateway)
                any("device.testAndSave", in: app).tap()
                XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 35))
                if any("settings.close", in: app).exists { any("settings.close", in: app).tap() }
                XCTAssertTrue(scope.waitForExistence(timeout: 10))
                if scope.value as? String != deviceName {
                    scope.tap()
                    let updatedMenu = app.collectionViews.containing(.button, identifier: "设置").firstMatch
                    XCTAssertTrue(updatedMenu.waitForExistence(timeout: 8))
                    let savedDevice = updatedMenu.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", deviceName)).firstMatch
                    XCTAssertTrue(savedDevice.waitForExistence(timeout: 8)); XCTAssertTrue(savedDevice.isHittable); savedDevice.tap()
                }
            }
        }
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "sidebar.conversation.", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 25)); row.tap()
        let body = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value CONTAINS %@", "assistant.selectable", "这段文字用于选文引用验收")).firstMatch
        select(body, app: app, expectedMenu: "在 Sidechat 中提问"); capture("真实主聊天-系统选文菜单", app: app)
        app.menuItems["在 Sidechat 中提问"].tap()
        XCTAssertTrue(app.buttons["sidechat.return"].waitForExistence(timeout: 35))
        XCTAssertTrue(any("composer.quote", in: app).exists)
        let input = any("message-input", in: app); input.tap(); input.typeText("仅用于界面验收，请只回复 SELECTION_QUOTE_OK，不调用工具，不修改文件。")
        app.buttons["composer.submit"].tap()
        let reply = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value CONTAINS %@", "assistant.selectable", "SELECTION_QUOTE_OK")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 90),app.debugDescription)
        capture("真实选文Sidechat-独立回复", app: app)
        app.buttons["conversation.actions"].tap()
        let conversationMenu = app.collectionViews.containing(.button, identifier: "关闭 Sidechat").firstMatch
        XCTAssertTrue(conversationMenu.waitForExistence(timeout: 10))
        let close = conversationMenu.buttons.matching(NSPredicate(format: "label == %@", "关闭 Sidechat")).firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 10)); XCTAssertTrue(close.isHittable); close.tap()
        let alert = app.alerts["确认操作"]; XCTAssertTrue(alert.waitForExistence(timeout: 8)); alert.buttons["确认"].tap()
        XCTAssertTrue(app.buttons["会话列表"].waitForExistence(timeout: 25))
        XCTAssertFalse(app.buttons["sidechat.return"].exists)
    }
}
