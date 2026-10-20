import XCTest

/// 仅连接显式指定的独立测试网关，不向既有用户聊天发送消息。
@MainActor
final class SidechatEditingUITests: XCTestCase {
    func testProjectInheritanceSteeringAndHistoryEditing() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let gateway = env["CODEX_TEST_GATEWAY"] ?? env["TEST_RUNNER_CODEX_TEST_GATEWAY"] else { throw XCTSkip("需要独立测试网关") }
        let title = "新对话与Sidechat验收", device = "Sidechat 修复验收"
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
        func capture(_ name: String) { let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image) }
        func tapVisible(_ title: String) {
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", title)).allElementsBoundByIndex
            guard let button = matches.first(where: { $0.isHittable }) else { XCTFail("没有可见按钮：\(title)\n\(app.debugDescription)"); return }
            button.tap()
        }
        func sidebar() {
            let more = app.buttons["sidebar.more"]
            if more.exists && more.isHittable { return }
            app.buttons["line.3.horizontal"].tap()
            let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: more)
            XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 15), .completed, app.debugDescription)
        }
        let initialAddress = element("device.address")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            initialAddress.exists || (app.buttons["line.3.horizontal"].exists && app.buttons["line.3.horizontal"].isHittable) || (app.buttons["sidebar.more"].exists && app.buttons["sidebar.more"].isHittable)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed, app.debugDescription)
        if initialAddress.exists {
            let name = element("device.name"); name.tap(); name.typeText(device)
            initialAddress.tap(); initialAddress.typeText(gateway); element("device.testAndSave").tap()
            let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", device), object: app.buttons["new.computer"])
            XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 35), .completed, app.debugDescription)
            app.terminate(); app.launch()
        }
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", device), object: app.buttons["new.computer"])
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 30), .completed, app.debugDescription)
        sidebar(); app.buttons["sidebar.more"].tap()
        let menu = app.collectionViews.containing(.button, identifier: "设置").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 8))
        let existing = menu.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", device)).firstMatch
        if existing.exists { existing.tap() }
        else {
            menu.buttons["设置"].tap()
            let form = element("settings.form"); XCTAssertTrue(form.waitForExistence(timeout: 8))
            form.buttons.matching(NSPredicate(format: "label BEGINSWITH '设备'")).firstMatch.tap()
            let add = app.buttons["devices.add"]
            let list = app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
            for _ in 0..<8 { if add.isHittable { break }; list.swipeUp() }
            XCTAssertTrue(add.isHittable); add.tap()
            let name = element("device.name"); XCTAssertTrue(name.waitForExistence(timeout: 8)); name.tap(); name.typeText(device)
            let address = element("device.address"); address.tap(); address.typeText(gateway)
            element("device.testAndSave").tap()
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 35), app.debugDescription)
            if element("settings.close").exists { element("settings.close").tap() }
            sidebar(); app.buttons["sidebar.more"].tap()
            app.collectionViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", device)).firstMatch.tap()
        }
        func openMain() {
            sidebar(); app.buttons["sidebar.search"].tap()
            let search = element("sidebar.searchField"); XCTAssertTrue(search.waitForExistence(timeout: 8)); search.tap(); search.typeText(title)
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.conversation.' AND label == %@", title)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 25), app.debugDescription); row.tap()
            XCTAssertTrue(app.buttons["header.newConversation"].waitForExistence(timeout: 15))
        }
        func action(_ title: String) {
            app.buttons["conversation.actions"].tap()
            let menu = app.collectionViews.firstMatch; XCTAssertTrue(menu.waitForExistence(timeout: 8))
            let button = menu.buttons[title].firstMatch; XCTAssertTrue(button.waitForExistence(timeout: 8))
            for _ in 0..<4 { if button.isHittable { break }; menu.swipeUp() }
            button.tap()
        }
        func send(_ text: String) { let input = element("message-input"); input.tap(); input.typeText(text); app.buttons["composer.submit"].tap() }
        func answer(_ text: String) -> XCUIElement { app.textViews.matching(NSPredicate(format: "identifier == 'assistant.selectable' AND value CONTAINS %@", text)).firstMatch }
        openMain(); app.buttons["header.newConversation"].tap()
        XCTAssertTrue(app.buttons["new.project"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["new.project"].label.contains("newchat-sidechat-20261020"), app.debugDescription)
        XCTAssertTrue(app.buttons["new.computer"].label.contains(device)); capture("新对话继承当前项目和机器")
        openMain(); action("新建 Sidechat")
        XCTAssertTrue(app.buttons["sidechat.return"].waitForExistence(timeout: 30))
        send("记住校验代号 UI_MEMORY_47，仅回复 UI_KEEP_OK。")
        XCTAssertTrue(answer("UI_KEEP_OK").waitForExistence(timeout: 90), app.debugDescription)
        send("仅回复 UI_EDIT_OLD。")
        XCTAssertTrue(answer("UI_EDIT_OLD").waitForExistence(timeout: 90), app.debugDescription)
        let old = app.textViews.matching(NSPredicate(format: "identifier == 'user.selectable' AND value CONTAINS %@", "UI_EDIT_OLD")).firstMatch
        old.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).press(forDuration: 1)
        XCTAssertTrue(app.buttons["编辑"].waitForExistence(timeout: 8)); app.buttons["编辑"].tap()
        let editor = element("history.editor"); XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.tap(); editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40)); editor.typeText("仅回复你记住的校验代号。")
        capture("Sidechat原位置编辑消息")
        tapVisible("保存并重发")
        if app.buttons["删除后续并重发"].firstMatch.waitForExistence(timeout: 3) { tapVisible("删除后续并重发") }
        XCTAssertTrue(answer("UI_MEMORY_47").waitForExistence(timeout: 90), app.debugDescription)
        XCTAssertFalse(answer("UI_EDIT_OLD").exists); capture("重建后保留前文并替换原分支")
        send("逐行输出从1到1200的数字，每个独占一行。")
        send("立即结束数字列表，仅回复 UI_STEER_OK。")
        let steer = app.buttons["改为引导"].firstMatch
        XCTAssertTrue(steer.waitForExistence(timeout: 12), app.debugDescription); steer.tap()
        XCTAssertTrue(answer("UI_STEER_OK").waitForExistence(timeout: 90), app.debugDescription); capture("Sidechat队列转为引导成功")
        action("关闭 Sidechat")
        let alert = app.alerts["确认操作"]; XCTAssertTrue(alert.waitForExistence(timeout: 8)); alert.buttons["确认"].tap()
        XCTAssertTrue(app.buttons["会话列表"].waitForExistence(timeout: 15))
        app.terminate()
    }
}
