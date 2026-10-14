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

    func testDraftAndOfflineReferenceSendDoNotCreateRealConversation() {
        let app = reference()
        let input = app.descendants(matching: .any)["native-composer-input"]
        input.tap()
        input.typeText("检查原生输入")
        XCTAssertTrue(app.buttons["native-send"].isEnabled)
        app.buttons["native-send"].tap()
        XCTAssertTrue(app.staticTexts["检查原生输入"].exists)
    }
}
