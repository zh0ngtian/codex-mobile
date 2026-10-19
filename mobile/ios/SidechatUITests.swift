import XCTest

/// 显式指定测试网关设备及可读主聊天；只向临时Sidechat发送测试消息。
@MainActor
final class SidechatUITests: XCTestCase {
    func testSidechatRoundTripSwitchRestoreAndClose() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let title = environment["CODEX_SIDECHAT_MAIN_TITLE"] ?? environment["TEST_RUNNER_CODEX_SIDECHAT_MAIN_TITLE"] else { throw XCTSkip("需指定只读验收主聊天标题") }
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        func openMain() {
            let more = app.buttons["sidebar.more"]
            if !more.isHittable { app.buttons["会话列表"].tap() }
            XCTAssertTrue(more.waitForExistence(timeout: 20))
            if !(more.value as? String ?? "").contains("Sidechat") {
                more.tap()
                app.buttons["Sidechat 验收"].tap()
            }
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "sidebar.conversation.", title)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 25), app.debugDescription)
            if !row.isHittable { app.scrollViews.firstMatch.swipeUp() }
            row.tap()
            XCTAssertTrue(app.buttons["conversation.actions"].waitForExistence(timeout: 20))
        }
        func menu(_ title: String) {
            app.buttons["conversation.actions"].tap()
            let menu = app.collectionViews.firstMatch
            XCTAssertTrue(menu.waitForExistence(timeout: 8), app.debugDescription)
            let action = menu.buttons[title].firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 8), app.debugDescription)
            action.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        func capture(_ name: String) {
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        }
        openMain()
        menu("新建 Sidechat")
        XCTAssertTrue(app.buttons["sidechat.return"].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "sidechat.sharedDirectory").firstMatch.exists)
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap()
        input.typeText("For UI verification only, reply exactly SIDECHAT_IOS_OK. Do not run tools or change files.")
        app.buttons["composer.submit"].tap()
        let answer = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value == %@", "assistant.selectable", "SIDECHAT_IOS_OK")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 90), app.debugDescription)
        XCTAssertEqual(app.otherElements.matching(identifier: "message.user-bubble").count, 1, "真实消息应替换临时用户气泡")
        capture("Sidechat-真实独立回复与共享目录提示")
        app.buttons["sidechat.return"].tap()
        XCTAssertTrue(app.buttons["conversation.actions"].waitForExistence(timeout: 15))
        menu("新建 Sidechat")
        XCTAssertTrue(app.buttons["sidechat.return"].waitForExistence(timeout: 30))
        XCTAssertFalse(answer.exists, "第二分支不应显示第一分支消息")
        app.buttons["sidechat.return"].tap()
        menu("Sidechat 1")
        XCTAssertTrue(answer.waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        openMain(); menu("Sidechat 1")
        XCTAssertTrue(answer.waitForExistence(timeout: 15), "App重启后应从daemon内存恢复新增消息")
        capture("Sidechat-App重启恢复")
        menu("关闭 Sidechat")
        XCTAssertTrue(app.buttons["会话列表"].waitForExistence(timeout: 15))
        menu("Sidechat 2"); menu("关闭 Sidechat")
        capture("Sidechat-关闭两个测试分支后返回主聊天")
    }
}
