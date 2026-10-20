import XCTest

@MainActor final class PendingSteerMessageUITests: XCTestCase {
    private let body = "顺便把这个改了：运行过程中默认展开执行过程"
    private let gateway = "http://127.0.0.1:18843"
    private func element(_ id: String, _ app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func control(_ command: String) async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: URL(string: gateway + "/__control/" + command)!)
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }
    private func openChat() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let address = app.textFields.matching(identifier: "device.address").firstMatch
        let add = app.buttons["devices.addFirst"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            address.exists || add.exists || app.buttons["composer.attachments"].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        if add.exists && !address.exists { add.tap() }
        if !app.buttons["composer.attachments"].exists {
            XCTAssertTrue(address.waitForExistence(timeout: 12), app.debugDescription)
            let name = app.textFields.matching(identifier: "device.name").firstMatch; name.tap(); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80)); name.typeText("引导消息验收")
            address.tap(); address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 180)); address.typeText(gateway + "/?token=reconciliation-fixture")
            element("device.testAndSave", app).tap()
            XCTAssertTrue(app.buttons["composer.attachments"].waitForExistence(timeout: 35), app.debugDescription)
            // 首次连接后从已保存设备重启，统一后续会话验收的入口。
            app.terminate(); app.launch()
            XCTAssertTrue(app.buttons["composer.attachments"].waitForExistence(timeout: 20), app.debugDescription)
        }
        if !app.buttons["drawer.close-surface"].exists {
            // iOS 27 的 AX 会保留隐藏的网页按钮；从截图确认的原生导航按钮中心发出触摸。
            app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 42, dy: 84)).tap()
        }
        XCTAssertTrue(app.buttons["drawer.close-surface"].waitForExistence(timeout: 8), app.debugDescription)
        app.buttons["sidebar.search"].tap()
        let search = element("sidebar.searchField", app); XCTAssertTrue(search.waitForExistence(timeout: 8)); search.tap(); search.typeText("重复气泡模拟器验收")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.conversation.' AND label == %@", "重复气泡模拟器验收")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), app.debugDescription); row.tap()
        XCTAssertTrue(app.buttons["composer.attachments"].waitForExistence(timeout: 15)); return app
    }
    private func matchingMessages(_ app: XCUIApplication) -> XCUIElementQuery {
        app.textViews.matching(NSPredicate(format: "identifier == 'user.selectable' AND value == %@", body))
    }
    private func send(_ app: XCUIApplication) {
        let input = element("message-input", app); input.tap(); input.typeText(body); app.buttons["composer.submit"].tap()
        let deny = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["不允许"]
        if deny.waitForExistence(timeout: 3) { deny.tap() }
    }
    private func beginSteer(_ app: XCUIApplication) {
        send(app)
        let steer = element("agent-ui-root", app).buttons["改为引导"]
        XCTAssertTrue(steer.waitForExistence(timeout: 15), app.debugDescription)
        steer.tap()
    }
    func testPendingGuidanceIsUserBubbleBeforeAndAfterConfirmationAndReopen() async throws {
        continueAfterFailure = false
        _ = try await control("reset")
        let app = openChat()
        beginSteer(app)
        XCTAssertTrue(matchingMessages(app).firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(matchingMessages(app).count, 1)
        XCTAssertFalse(app.textViews.matching(NSPredicate(format: "identifier IN {'assistant.selectable', 'commentary.selectable'} AND value == %@", body)).firstMatch.exists)
        capture("待确认引导-用户气泡", app)
        _ = try await control("confirm-steer")
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "value == %@", "已收到引导，继续处理。")).firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(matchingMessages(app).count, 1)
        capture("正式确认-只保留一个气泡", app)
        _ = try await control("complete")
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "identifier == 'assistant.selectable' AND value CONTAINS %@", "第0次发送处理完成")).firstMatch.waitForExistence(timeout: 15))
        XCTAssertEqual(matchingMessages(app).count, 1)
        app.terminate()
        let reopened = openChat()
        XCTAssertTrue(matchingMessages(reopened).firstMatch.waitForExistence(timeout: 15), reopened.debugDescription)
        XCTAssertEqual(matchingMessages(reopened).count, 1)
        capture("重新进入-引导仍是用户消息", reopened)
        reopened.terminate()
    }
    func testRejectedGuidanceRemovesTemporaryBubbleAndKeepsQueuedMessage() async throws {
        continueAfterFailure = false
        _ = try await control("reset")
        let app = openChat()
        beginSteer(app)
        XCTAssertTrue(matchingMessages(app).firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        _ = try await control("reject-steer")
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: matchingMessages(app).firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [removed], timeout: 15), .completed)
        XCTAssertTrue(element("agent-ui-root", app).buttons["改为引导"].waitForExistence(timeout: 10), app.debugDescription)
        capture("引导失败-临时气泡清理且队列保留", app)
        app.terminate()
    }
}
