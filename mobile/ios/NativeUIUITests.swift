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
        app.buttons["管理排队消息"].tap()
        XCTAssertTrue(app.buttons["发送"].waitForExistence(timeout: 3))
        app.buttons["发送"].tap()
        XCTAssertFalse(app.otherElements["native-queued-messages"].exists)
    }

    func testSidebarRenameCollectsNameInNativeAlert() {
        let app = reference(true)
        app.buttons["native-sidebar-open"].tap()
        app.otherElements["native-sidebar"].scrollViews.firstMatch.swipeUp()
        app.buttons["native-navigation-conversation"].press(forDuration: 1)
        app.buttons["重命名"].tap()
        let alert = app.alerts["重命名会话"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        XCTAssertFalse(alert.buttons["保存"].isEnabled)
        alert.textFields.firstMatch.tap()
        alert.textFields.firstMatch.typeText("已修改名称")
        alert.buttons["保存"].tap()
        XCTAssertFalse(alert.exists)
    }

    func testSettingsChildPageReturnsWithinSettings() {
        let app = reference()
        app.buttons["native-sidebar-open"].tap()
        app.buttons["native-settings-open"].tap()
        app.buttons["语言"].tap()
        XCTAssertTrue(app.staticTexts["语言设置"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["设置"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 3))
        app.buttons["完成"].tap()
    }

    func testRichContentUsesNativeTableAndScriptFreeIsolatedPreview() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-rich"]
        app.launch()
        let preview = app.webViews.firstMatch
        XCTAssertTrue(preview.staticTexts["安全预览"].waitForExistence(timeout: 10))
        XCTAssertFalse(preview.staticTexts["脚本已执行"].exists)
        XCTAssertTrue(app.staticTexts["单元格 A"].exists)
        XCTAssertTrue(app.staticTexts["已完成的任务"].exists)
        XCTAssertTrue(app.buttons["全屏查看"].exists)
    }

    func testSVGOriginalPreviewRemainsDownloadable() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-svg"]
        app.launch()
        app.buttons["查看图片 vector.svg"].tap()
        XCTAssertTrue(app.navigationBars["vector.svg"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews.staticTexts["矢量原图"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["下载原图"].isEnabled)
    }

    func testRemoteSourceFocusesLinkedLine() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-source"]
        app.launch()
        let target = app.staticTexts["let line40 = 40"]
        expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: target)
        waitForExpectations(timeout: 8)
        XCTAssertTrue(app.buttons["复制全文"].exists)
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
