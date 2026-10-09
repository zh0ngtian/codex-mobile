import XCTest

/// 使用已经配置网关的测试设备；测试本身不改设备、项目或会话配置。
final class NativeConversationUITests: XCTestCase {
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testCaptureConversationDesign() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let table = try openLongConversation(app)
        XCTAssertTrue(table.cells.firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        capture(app, "01-conversation")
        table.swipeDown()
        table.swipeDown()
        capture(app, "02-reading-history")
        app.buttons["codex.native.back"].tap()
        let chat = app.webViews.buttons["聊天"]
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        chat.tap()
        let composer = app.textViews["codex.native.composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        capture(app, "03-new-conversation")
        composer.tap()
        composer.typeText("把这段内容整理成清晰的实施步骤。\n保留关键细节。")
        capture(app, "04-keyboard-draft")
        app.toolbars.buttons["codex.native.keyboard.done"].tap()
        capture(app, "05-keyboard-dismissed")
    }
    private func openConversation(_ app: XCUIApplication) -> XCUIElement {
        app.launch()
        let chat = app.webViews.buttons["聊天"]
        XCTAssertTrue(chat.waitForExistence(timeout: 30), app.debugDescription)
        chat.tap()
        let composer = app.textViews["codex.native.composer"]
        if !composer.waitForExistence(timeout: 5) { chat.tap() }
        XCTAssertTrue(composer.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(app.webViews.textViews["codex.native.composer"].exists)
        XCTAssertTrue(app.tables["codex.native.timeline"].exists)
        XCTAssertTrue(composer.isHittable, "原生输入框必须可交互，不能只在AX树显示")
        XCTAssertTrue(app.buttons["codex.native.back"].isHittable, "原生header必须可交互")
        return composer
    }

    func testEmptyComposerUsesAvailableWidth() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let composer = openConversation(app)
        XCTAssertGreaterThan(composer.frame.width, app.frame.width * 0.65, "空输入框必须可见且占据足够宽度")
        let send = app.buttons["codex.native.send"]
        XCTAssertGreaterThanOrEqual(send.frame.width, 44)
        XCTAssertLessThanOrEqual(send.frame.maxX, app.frame.maxX)
        XCTAssertGreaterThanOrEqual(composer.frame.height, 44)
        capture(app, "empty-composer-width")
    }

    func testNativeDraftKeyboardDoneAndBackRestore() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let composer = openConversation(app)
        composer.tap()
        composer.typeText("未发送中文草稿\n第二行")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.toolbars.buttons["codex.native.keyboard.done"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertEqual(composer.value as? String, "未发送中文草稿\n第二行")
        composer.tap()
        composer.typeText("继续编辑")
        app.toolbars.buttons["codex.native.keyboard.done"].tap()
        app.buttons["codex.native.back"].tap()
        XCTAssertTrue(app.webViews.buttons["聊天"].waitForExistence(timeout: 10))
        app.webViews.buttons["关闭会话列表"].tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        let restoredDraft = composer.value as? String ?? ""
        XCTAssertTrue(restoredDraft.contains("继续编辑"))
        XCTAssertEqual(restoredDraft.replacingOccurrences(of: "继续编辑", with: ""), "未发送中文草稿\n第二行")
        // 清理测试草稿，避免影响后续测试；始终由原生 draft action 同步 React。
        composer.tap()
        composer.press(forDuration: 1.2)
        let selectAll = app.menuItems.matching(NSPredicate(format: "label IN %@", ["全选", "Select All"])).firstMatch
        if selectAll.waitForExistence(timeout: 2) {
            selectAll.tap()
            composer.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        app.toolbars.buttons["codex.native.keyboard.done"].tap()
    }

    func testNativeSubmitReachesReactConversation() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let composer = openConversation(app)
        composer.tap()
        if let current = composer.value as? String, !current.isEmpty {
            composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        composer.typeText("请只回复 NATIVE_IOS_OK，不调用工具，不修改文件。")
        let send = app.buttons["codex.native.send"]
        XCTAssertTrue(send.isHittable)
        send.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        let reply = app.tables["codex.native.timeline"].textViews.matching(
            NSPredicate(format: "value == %@", "NATIVE_IOS_OK")
        ).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 120), app.debugDescription)
        XCTAssertEqual(composer.value as? String, "")
    }

    func testMarkdownReplyUsesNativeTableAndCode() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let composer = openConversation(app)
        composer.tap()
        composer.typeText("请只回复以下 Markdown，不调用工具、不修改文件：\n\n## 阅读验收\n\n这是一段清晰的中文回复，包含 **重点** 与完整段落。\n\n- 第一步：检查界面\n- 第二步：保留细节\n\n```swift\nlet message = \"清晰可读\"\nprint(message)\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| 输入框 | 可编辑 |\n| 长回复 | 可阅读 |")
        app.buttons["codex.native.send"].tap()
        let table = app.tables["codex.native.timeline"]
        let renderedTable = table.scrollViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "codex.native.table.")).firstMatch
        XCTAssertTrue(renderedTable.waitForExistence(timeout: 120), app.debugDescription)
        XCTAssertTrue(table.textViews.matching(NSPredicate(format: "value == %@", "输入框")).firstMatch.exists)
        XCTAssertTrue(table.textViews.matching(NSPredicate(format: "value == %@", "可编辑")).firstMatch.exists)
        XCTAssertLessThanOrEqual(renderedTable.frame.maxX, app.frame.maxX)
        capture(app, "06-markdown-table-code")
        table.swipeDown()
        capture(app, "07-markdown-headings-lists")
    }

    func testCaptureReadableReplyDesign() throws {
        continueAfterFailure = false
        guard let title = ProcessInfo.processInfo.environment["NATIVE_IOS_DESIGN_THREAD_TITLE"], !title.isEmpty else {
            throw XCTSkip("指定 NATIVE_IOS_DESIGN_THREAD_TITLE 可捕获已生成的阅读验收回复；功能回归由真实 Markdown 发送测试覆盖")
        }
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let thread = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 30), app.debugDescription)
        thread.tap()
        let table = app.tables["codex.native.timeline"]
        XCTAssertTrue(table.cells.firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        let latest = app.buttons["codex.native.latest"]
        if latest.isHittable { latest.tap() }
        capture(app, "08-readable-reply")
    }

    func testActivityDetailsRemainAccessible() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let table = try openLongConversation(app)
        let activity = table.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "codex.native.activity.")).firstMatch
        for _ in 0..<12 {
            if activity.isHittable { break }
            table.swipeDown()
        }
        XCTAssertTrue(activity.isHittable, app.debugDescription)
        capture(app, "09-folded-activity")
        activity.tap()
        XCTAssertTrue(app.textViews["codex.native.details.content"].waitForExistence(timeout: 5))
        capture(app, "10-activity-details")
        app.navigationBars.buttons["codex.native.details.done"].tap()
        XCTAssertTrue(app.textViews["codex.native.composer"].exists)
    }

    private func openLongConversation(_ app: XCUIApplication) throws -> XCUIElement {
        let title = ProcessInfo.processInfo.environment["NATIVE_IOS_SCROLL_THREAD_TITLE"] ?? "iOS 原生方案可行性、收益与风险评估"
        app.launch()
        let thread = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 30), app.debugDescription)
        thread.tap()
        let table = app.tables["codex.native.timeline"]
        XCTAssertTrue(table.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(table.cells.firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        return table
    }

    private func firstVisibleMessage(_ table: XCUIElement) throws -> XCUIElement {
        let message = table.textViews.allElementsBoundByIndex.first {
            $0.identifier.hasPrefix("codex.native.row.") && $0.frame.minY >= table.frame.minY && $0.frame.maxY <= table.frame.maxY
        }
        return try XCTUnwrap(message, "长对话需有至少一个完整可见消息")
    }

    func testReadingHistoryKeepsAnchorAndCanJumpToLatest() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let table = try openLongConversation(app)
        table.swipeDown()
        table.swipeDown()
        let latest = app.buttons["codex.native.latest"]
        XCTAssertTrue(latest.waitForExistence(timeout: 5), "对话长度应支持阅读历史")
        let anchor = try firstVisibleMessage(table)
        let id = anchor.identifier
        let y = anchor.frame.minY
        // 等待正在运行的真实对话状态更新；全程只读，不向指定历史会话发送请求。
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        let restored = table.textViews[id]
        XCTAssertTrue(restored.exists, "状态刷新不能把正在阅读的历史行移出屏幕")
        XCTAssertEqual(restored.frame.minY, y, accuracy: 3)
        latest.tap()
        XCTAssertTrue(latest.waitForNonExistence(timeout: 5), "跳到最新后应回到底部并隐藏按钮")
        XCTAssertTrue(app.textViews["codex.native.composer"].exists)
    }

    func testLoadingOlderMessagesKeepsVisibleRowOffset() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let table = try openLongConversation(app)
        let older = app.buttons["codex.native.load-older"]
        for _ in 0..<40 {
            if older.isHittable { break }
            table.swipeDown()
        }
        XCTAssertTrue(older.exists, "NATIVE_IOS_SCROLL_THREAD_TITLE 对应会话必须含可分页的更早消息")
        XCTAssertTrue(older.isHittable, app.debugDescription)
        let anchor = try firstVisibleMessage(table)
        let id = anchor.identifier
        let y = anchor.frame.minY
        older.tap()
        let loaded = NSPredicate(format: "enabled == true OR exists == false")
        expectation(for: loaded, evaluatedWith: older)
        waitForExpectations(timeout: 30)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        let restored = table.textViews[id]
        XCTAssertTrue(restored.exists, "插入更早消息后稳定 row ID 应继续可见")
        XCTAssertEqual(restored.frame.minY, y, accuracy: 3)
    }

}
