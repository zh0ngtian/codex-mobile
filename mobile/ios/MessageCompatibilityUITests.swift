import XCTest

@MainActor final class MessageCompatibilityUITests: XCTestCase {
    private func any(_ id: String, _ app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func capture(_ name: String, _ app: XCUIApplication) { let value = XCTAttachment(screenshot: app.screenshot()); value.name = name; value.lifetime = .keepAlways; add(value) }
    private func openTestChat() throws -> XCUIApplication {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let title = env["TEST_RUNNER_COMPAT_TITLE"] ?? env["COMPAT_TITLE"], let gateway = env["TEST_RUNNER_COMPAT_GATEWAY"] ?? env["COMPAT_GATEWAY"] else { throw XCTSkip("需要指定独立测试网关与测试聊天") }
        let app = XCUIApplication(); app.launchArguments = ["--native-ui-live", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]; app.launch()
        let address = any("device.address", app)
        if address.waitForExistence(timeout: 3) {
            let name = any("device.name", app); name.tap(); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80)); name.typeText("Compatibility QA")
            address.tap(); address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 180)); address.typeText(gateway)
            let save = any("device.testAndSave", app); XCTAssertTrue(save.isEnabled, app.debugDescription); save.tap()
            XCTAssertTrue(app.buttons["sidebar.more"].waitForExistence(timeout: 40) || app.navigationBars["设备"].exists, app.debugDescription)
            if any("settings.close", app).exists { any("settings.close", app).tap() }
            if app.buttons["完成设备设置"].exists { app.buttons["完成设备设置"].tap() }
        }
        if !app.buttons["sidebar.search"].isHittable { app.buttons["会话列表"].tap() }
        XCTAssertTrue(app.buttons["sidebar.search"].waitForExistence(timeout: 20)); app.buttons["sidebar.search"].tap()
        let search = any("sidebar.searchField", app); XCTAssertTrue(search.waitForExistence(timeout: 8)); search.tap(); search.typeText(env["TEST_RUNNER_COMPAT_QUERY"] ?? env["COMPAT_QUERY"] ?? title)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.conversation.' AND label == %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30), app.debugDescription); row.tap()
        XCTAssertTrue(app.buttons["conversation.actions"].waitForExistence(timeout: 20)); return app
    }
    func test10DesktopAttachmentsReferencesAndReload() throws {
        var app = try openTestChat()
        let reference = any("message.reference", app)
        XCTAssertTrue(reference.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.buttons["验收图片.png"].exists, "同一路径的图片声明与localImage只显示一个缩略图")
        XCTAssertEqual(app.buttons.matching(identifier: "验收图片.png").count, 1)
        let text = app.textViews.matching(identifier: "user.selectable").allElementsBoundByIndex.compactMap { $0.value as? String }.joined(separator: "\n")
        XCTAssertFalse(text.contains("Files mentioned")); XCTAssertFalse(text.contains("response-annotations")); XCTAssertFalse(text.contains("/Users/")); XCTAssertTrue(text.contains("COMPAT_OK"))
        app.buttons["message.reference.toggle"].firstMatch.tap(); capture("桌面消息-引用展开与附件卡片", app); XCTAssertTrue(app.buttons["message.reference.source"].waitForExistence(timeout: 8), app.debugDescription)
        let file = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "验收文件.txt")).firstMatch; XCTAssertTrue(file.exists); file.tap()
        XCTAssertTrue(app.navigationBars["验收文件.txt"].waitForExistence(timeout: 8))
        let content = app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@ OR label CONTAINS %@", "这是附件预览验收文件", "这是附件预览验收文件")).firstMatch
        XCTAssertTrue(content.waitForExistence(timeout: 15), app.debugDescription); XCTAssertTrue(app.buttons["下载"].isEnabled); capture("文本附件-真实字节预览与下载入口", app)
        app.buttons["关闭"].tap()
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.navigationBars["验收文件.txt"])
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 5), .completed)
        capture("引用展开-稳定画面", app)
        app.terminate(); app = try openTestChat()
        XCTAssertTrue(any("message.reference", app).waitForExistence(timeout: 12)); XCTAssertEqual(app.buttons.matching(identifier: "验收图片.png").count, 1); capture("重新启动-引用附件呈现一致", app)
    }
    func test20PhoneQuotesAndHEICSend() throws {
        let app = try openTestChat()
        let reply = app.textViews.matching(NSPredicate(format: "identifier == 'assistant.selectable' AND value CONTAINS 'COMPAT_OK'")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 15)); reply.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).press(forDuration: 1.2)
        XCTAssertTrue(app.menuItems["加入聊天"].waitForExistence(timeout: 5), app.debugDescription); app.menuItems["加入聊天"].tap()
        XCTAssertTrue(any("composer.quote", app).waitForExistence(timeout: 8))
        app.buttons["composer.attachments"].tap(); app.buttons["composer.attachments.photos"].tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch; XCTAssertTrue(photo.waitForExistence(timeout: 10), app.debugDescription); photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let add = app.navigationBars["照片"].buttons["Add"]; XCTAssertTrue(add.waitForExistence(timeout: 8)); add.tap()
        let attachment = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.attachment.'")).firstMatch
        XCTAssertTrue(attachment.waitForExistence(timeout: 15), app.debugDescription); XCTAssertTrue(attachment.label.lowercased().contains("jpg"), "HEIC进入草稿前转换为JPEG")
        let input = any("message-input", app); input.tap(); input.typeText("Please reply MOBILE_COMPAT_OK and append the required annotation marker. Do not call tools.")
        capture("手机发送前-引用及HEIC转换后的JPEG", app)
        app.buttons["composer.submit"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deny = springboard.alerts.buttons["不允许"]
        if deny.waitForExistence(timeout: 3) { deny.tap() }
        let answer = app.textViews.matching(NSPredicate(format: "identifier == 'assistant.selectable' AND value CONTAINS 'MOBILE_COMPAT_OK'")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 100), app.debugDescription)
        XCTAssertFalse(any("composer.quote", app).exists); capture("手机发送后-引用图片与回复", app)
    }
    /// 对用户指定聊天只读验收，不发送、不保存重发、不归档用户聊天。
    func test30FirstAttachmentMessageHidesTitleRequest() throws {
        var app = try openTestChat()
        func verifyFirstMessage(_ app: XCUIApplication) {
            let first = app.textViews.matching(NSPredicate(format: "identifier == 'user.selectable' AND value == %@", "我")).firstMatch
            let timeline = any("conversation.timeline", app)
            for _ in 0..<5 { if first.exists && first.isHittable { break }; timeline.swipeDown() }
            XCTAssertTrue(first.waitForExistence(timeout: 12), app.debugDescription)
            XCTAssertTrue(first.isHittable)
            let texts = app.textViews.matching(identifier: "user.selectable").allElementsBoundByIndex.compactMap { $0.value as? String }.joined(separator: "\n")
            XCTAssertFalse(texts.contains("conversation_title_request")); XCTAssertFalse(texts.contains("请根据这条用户消息"))
            XCTAssertEqual(app.buttons.matching(identifier: "compat-photo.jpg").count, 1)
            XCTAssertTrue(app.buttons["composer.attachments"].isEnabled, "共享后端应恢复该聊天的正常输入")
            capture("用户样本首条消息-仅正文和一张图片", app)
        }
        verifyFirstMessage(app)
        let bubble = app.descendants(matching: .any).matching(identifier: "message.user-bubble").containing(NSPredicate(format: "identifier == 'user.selectable' AND value == %@", "我")).firstMatch
        XCTAssertTrue(bubble.exists)
        bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).press(forDuration: 1.2)
        let menu = app.collectionViews.containing(.button, identifier: "编辑").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 8), app.debugDescription)
        menu.buttons.matching(NSPredicate(format: "label == %@", "编辑")).firstMatch.tap()
        let editor = any("history.editor", app); XCTAssertTrue(editor.waitForExistence(timeout: 10))
        XCTAssertEqual(editor.value as? String, "我", "历史编辑只恢复用户问题，不带内部标题请求")
        capture("首条消息历史编辑-正文干净并保留图片", app)
        app.buttons.matching(NSPredicate(format: "label == %@", "取消")).firstMatch.tap()
        let cancelled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: editor)
        XCTAssertEqual(XCTWaiter.wait(for: [cancelled], timeout: 6), .completed)
        app.terminate(); app = try openTestChat(); verifyFirstMessage(app)
    }

}
