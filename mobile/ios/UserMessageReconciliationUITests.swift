import XCTest

@MainActor final class UserMessageReconciliationUITests: XCTestCase {
    private let body = "一方面做你前面的1和2，如果整轮时间仍在1s之外，再尝试增大并发"
    private let gateway = "http://127.0.0.1:18839"
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
            let name = app.textFields.matching(identifier: "device.name").firstMatch; name.tap(); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80)); name.typeText("消息去重验收")
            address.tap(); address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 180)); address.typeText(gateway + "/?token=reconciliation-fixture")
            element("device.testAndSave", app).tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: address)
            XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 35), .completed, app.debugDescription)
            XCTAssertTrue(app.buttons["sidebar.more"].waitForExistence(timeout: 35) || app.navigationBars["设备"].exists, app.debugDescription)
            if element("settings.close", app).exists { element("settings.close", app).tap() }
            if app.buttons["完成设备设置"].exists { app.buttons["完成设备设置"].tap() }
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
    private func waitForRecovery(_ count: Int) async throws {
        let deadline = Date().addingTimeInterval(20)
        repeat {
            if try await control("status")["recoveries"] as? Int ?? 0 >= count { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        } while Date() < deadline
        XCTFail("过程回填没有完成")
    }
    func testRecoveryAcknowledgesOneLocalBubbleAndPreservesRealRepeatedSend() async throws {
        continueAfterFailure = false
        _ = try await control("reset")
        let app = openChat()
        send(app)
        try await waitForRecovery(1)
        let recoveredUI = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.buttons["commentary-history-toggle"].exists || app.textViews.matching(NSPredicate(format: "identifier IN {'assistant.selectable', 'commentary.selectable'} AND value CONTAINS %@", "第1次回填已到达")).count > 0
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [recoveredUI], timeout: 8), .completed)
        capture("一次发送-恢复回填后气泡数量", app)
        XCTAssertEqual(matchingMessages(app).count, 1, "一次发送只能显示一个用户气泡")
        let first = try await control("status"); XCTAssertEqual(first["starts"] as? Int, 1); XCTAssertGreaterThanOrEqual(first["recoveries"] as? Int ?? 0, 1)
        _ = try await control("complete")
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "identifier == 'assistant.selectable' AND value CONTAINS %@", "第1次发送处理完成")).firstMatch.waitForExistence(timeout: 15))
        send(app)
        try await waitForRecovery(2)
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "identifier IN {'assistant.selectable', 'commentary.selectable'} AND value CONTAINS %@", "第2次回填已到达")).firstMatch.waitForExistence(timeout: 12))
        capture("两次真实相同正文-保留两个气泡", app)
        XCTAssertEqual(matchingMessages(app).count, 2, "两次真实发送相同正文仍须保留两个气泡")
        _ = try await control("complete")
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "identifier == 'assistant.selectable' AND value CONTAINS %@", "第2次发送处理完成")).firstMatch.waitForExistence(timeout: 15))
        app.terminate()
        let reopened = openChat()
        XCTAssertTrue(matchingMessages(reopened).firstMatch.waitForExistence(timeout: 12))
        XCTAssertEqual(matchingMessages(reopened).count, 2)
        capture("重新启动-正式消息数量保持一致", reopened)
        let second = try await control("status"); XCTAssertEqual(second["starts"] as? Int, 2)
    }
}
