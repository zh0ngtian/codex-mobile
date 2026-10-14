import XCTest

@MainActor
final class NativeUIUITests: XCTestCase {
    private func reference(_ conversation: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [conversation ? "--native-ui-reference-conversation" : "--native-ui-reference"]
        app.launch()
        return app
    }

    func testReferenceUsesNativeRootAndHasNoVoiceEntry() {
        let app = reference()
        XCTAssertTrue(app.otherElements["native-ui-root"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["native-composer-input"].exists)
        XCTAssertFalse(app.buttons["语音"].exists)
        XCTAssertFalse(app.buttons["朗读"].exists)
        XCTAssertFalse(app.webViews.firstMatch.isHittable)
    }

    func testSidebarSettingsAndNewConversation() {
        let app = reference(true)
        app.buttons["native-sidebar-open"].tap()
        XCTAssertTrue(app.otherElements["native-sidebar"].exists)
        XCTAssertTrue(app.textFields["native-sidebar-search"].exists)
        app.buttons["native-settings-open"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 3))
        app.buttons["完成"].tap()
        app.buttons["native-sidebar-close"].tap()
        app.buttons["native-new-thread"].tap()
        XCTAssertTrue(app.staticTexts["你好，让我们开始吧"].exists)
    }

    func testShortReferenceConversationStartsBelowHeader() {
        let app = reference(true)
        let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "这是一次 UI ")).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        let sidebar = app.buttons["native-sidebar-open"]
        XCTAssertLessThan(message.frame.minY, sidebar.frame.maxY + 100, "短对话应从顶部开始，不能贴到底部输入卡")
    }

    func testDraftAndOfflineReferenceSendDoNotCreateRealConversation() {
        let app = reference()
        let input = app.descendants(matching: .any)["native-composer-input"]
        input.tap()
        input.typeText("检查原生输入")
        XCTAssertTrue(app.buttons["native-send"].isEnabled)
        app.buttons["native-send"].tap()
        XCTAssertTrue(app.staticTexts["检查原生输入"].exists)
    }

    func testBusyComposerKeepsQueueSendAndStopSeparate() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-busy"]
        app.launch()
        XCTAssertTrue(app.buttons["native-stop"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["native-send"].label, "排队发送")
        app.buttons["native-send"].tap()
        XCTAssertTrue(app.otherElements["native-queued-messages"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["native-send"].label, "停止")
        XCTAssertFalse(app.buttons["语音"].exists)
    }

    func testReadingHistoryDoesNotJumpWhenNewMessageArrives() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-long"]
        app.launch()
        let timeline = app.scrollViews["native-timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))
        timeline.swipeDown()
        timeline.swipeDown()
        XCTAssertTrue(app.buttons["native-jump-to-bottom"].waitForExistence(timeout: 3))
        let input = app.descendants(matching: .any)["native-composer-input"]
        input.tap()
        input.typeText("新增测试消息")
        app.buttons["native-send"].tap()
        XCTAssertFalse(app.staticTexts["新增测试消息"].isHittable)
        app.buttons["native-jump-to-bottom"].tap()
        let visible = NSPredicate(format: "hittable == true")
        expectation(for: visible, evaluatedWith: app.staticTexts["新增测试消息"])
        waitForExpectations(timeout: 5)
    }
}
