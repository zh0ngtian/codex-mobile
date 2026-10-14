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
        XCTAssertTrue(alert.buttons["保存"].isEnabled, app.debugDescription)
        alert.buttons["保存"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: alert)
        waitForExpectations(timeout: 3)
    }

    func testSidebarRenameCanCancel() {
        let app = reference(true)
        app.buttons["native-sidebar-open"].tap()
        app.otherElements["native-sidebar"].scrollViews.firstMatch.swipeUp()
        app.buttons["native-navigation-conversation"].press(forDuration: 1)
        app.buttons["重命名"].tap()
        let alert = app.alerts["重命名会话"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.textFields.firstMatch.tap()
        alert.textFields.firstMatch.typeText("已修改名称")
        alert.buttons["取消"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: alert)
        waitForExpectations(timeout: 3)
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

    func testUserMarkdownInlineImageOpensOriginal() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-inline-image"]
        app.launch()
        let image = app.buttons["查看图片 行内图片"]
        XCTAssertTrue(image.waitForExistence(timeout: 5))
        image.tap()
        XCTAssertTrue(app.navigationBars["行内图片"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["下载原图"].isEnabled)
    }

    func testLiveBootstrapClosesDeviceForm() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live"]
        app.launch()
        let field = app.textFields["native-field-name"]
        let firstLaunch = field.waitForExistence(timeout: 3)
        if !firstLaunch {
            openNativeSettings(app)
            app.collectionViews.buttons["设备"].tap()
            app.collectionViews.buttons["添加设备"].tap()
            XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
            app.navigationBars.buttons["设置"].tap()
        }
        app.buttons["完成"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: field)
        waitForExpectations(timeout: 5)
        if firstLaunch { XCTAssertTrue(app.buttons["添加设备"].exists) }
        else { XCTAssertTrue(app.otherElements["native-ui-root"].exists) }
    }

    func testLiveGatewayRoundtripAndArchive() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live"]
        app.launch()
        let name = app.textFields["native-field-name"]
        if name.waitForExistence(timeout: 3) {
        name.tap()
        name.typeText("CM_NATIVE_UI_QA")
        XCTAssertEqual(name.value as? String, "CM_NATIVE_UI_QA", "真实字段必须接收到输入")
        let address = app.secureTextFields["网关地址"]
        address.tap()
        address.typeText("http://127.0.0.1:18786/?token=ios-simulator-check")
        app.collectionViews.buttons["测试并保存"].tap()
        XCTAssertTrue(name.waitForNonExistence(timeout: 30), app.debugDescription)
        if app.buttons["完成"].waitForExistence(timeout: 1) { app.buttons["完成"].tap() }
        }
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 30), app.debugDescription)
        input.tap()
        input.typeText("这是 CM_NATIVE_UI_20261014 自动化验证。请只回复 NATIVE_IOS_OK，不调用工具，不修改文件。")
        let send = app.buttons["native-send"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: send)
        waitForExpectations(timeout: 30)
        send.tap()
        XCTAssertTrue(app.staticTexts["NATIVE_IOS_OK"].waitForExistence(timeout: 90), app.debugDescription)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "原生真实消息往返"; image.lifetime = .keepAlways; add(image)
        app.otherElements["native-ui-root"].buttons["会话操作"].tap()
        app.buttons["会话设置"].tap()
        app.collectionViews.buttons["归档"].tap()
        XCTAssertTrue(app.staticTexts["你好，让我们开始吧"].waitForExistence(timeout: 15), app.debugDescription)
    }

    func testLiveSwitchPreservesDraftAndImageAcrossBothInterfaces() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--native-ui-preference-probe"]
        app.launch()
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 20), app.debugDescription)
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: input)
        waitForExpectations(timeout: 15)
        app.buttons["native-new-thread"].tap()
        openNativeSettings(app)
        let initialToggle = app.switches["native-ui-preference"]
        if initialToggle.value as? String == "1" {
            initialToggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
            waitForToggle(initialToggle, value: "0")
        }
        app.buttons["完成"].tap()
        app.buttons["native-sidebar-close"].tap()
        input.tap()
        input.typeText("CM_SWITCH_DRAFT_20261014")
        app.otherElements["native-ui-root"].buttons["添加附件"].tap()
        app.buttons["照片"].tap()
        let picker = app.otherElements["codex.attachments.photos"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10), app.debugDescription)
        let photo = picker.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10), app.debugDescription)
        photo.tap()
        let addPhoto = picker.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@ OR label == %@ OR label == %@", "添加", "Add", "完成", "Done")).firstMatch
        XCTAssertTrue(addPhoto.waitForExistence(timeout: 5), app.debugDescription)
        addPhoto.tap()
        let remove = app.otherElements["native-ui-root"].buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "移除 ")).firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 15), app.debugDescription)
        let attachmentLabel = remove.label
        openNativeSettings(app)
        let toggle = app.switches["native-ui-preference"]
        XCTAssertEqual(toggle.value as? String, "0")
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        waitForToggle(toggle, value: "1")
        XCTAssertTrue(app.otherElements["native-ui-root"].exists, "本次启动不能热切换")
        app.terminate()
        app.launchArguments = ["--native-ui-preference-probe"]
        app.launch()
        expectation(for: NSPredicate(format: "value == %@", "CM_SWITCH_DRAFT_20261014"), evaluatedWith: input)
        waitForExpectations(timeout: 20)
        XCTAssertEqual(input.value as? String, "CM_SWITCH_DRAFT_20261014")
        XCTAssertTrue(app.otherElements["native-ui-root"].buttons[attachmentLabel].exists)
        openNativeSettings(app)
        app.switches["native-ui-preference"].coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        waitForToggle(app.switches["native-ui-preference"], value: "0")
        app.terminate()
        app.launch()
        let webInput = app.webViews.textViews["向 Codex 提问"]
        XCTAssertTrue(webInput.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertEqual(webInput.value as? String, "CM_SWITCH_DRAFT_20261014")
        XCTAssertTrue(app.webViews.buttons[attachmentLabel].exists, app.debugDescription)
        XCTAssertFalse(app.otherElements["native-ui-root"].exists)
        let manager = app.webViews.buttons["管理设备"]
        if !manager.isHittable { app.webViews.buttons["打开会话列表"].tap() }
        manager.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // iOS 27 的 WebKit AX 在这个 aria-modal 中没有返回 checkbox。
        // 本用例固定402×874验收机型，坐标来自实际设置页截图；重启后原生根与草稿仍须真实通过。
        let settingsImage = XCTAttachment(screenshot: app.screenshot())
        settingsImage.name = "旧界面可见切换开关"; settingsImage.lifetime = .keepAlways; add(settingsImage)
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 30, dy: 247)).tap()
        let savedPreference = app.staticTexts["native-ui-saved-preference"]
        expectation(for: NSPredicate(format: "label == %@", "1"), evaluatedWith: savedPreference)
        waitForExpectations(timeout: 20)
        XCTAssertFalse(app.otherElements["native-ui-root"].exists, "旧界面也只能在下次完整启动切换")
        app.terminate()
        app.launch()
        expectation(for: NSPredicate(format: "value == %@", "CM_SWITCH_DRAFT_20261014"), evaluatedWith: input)
        waitForExpectations(timeout: 20)
        XCTAssertEqual(input.value as? String, "CM_SWITCH_DRAFT_20261014")
        XCTAssertTrue(app.otherElements["native-ui-root"].buttons[attachmentLabel].exists)
        app.buttons["native-new-thread"].tap()
        openNativeSettings(app)
        app.switches["native-ui-preference"].coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        waitForToggle(app.switches["native-ui-preference"], value: "0")
    }

    private func openNativeSettings(_ app: XCUIApplication) {
        app.buttons["native-sidebar-open"].tap()
        app.buttons["native-settings-open"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 5), app.debugDescription)
    }

    private func waitForToggle(_ toggle: XCUIElement, value: String) {
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: toggle)
        let result = XCTWaiter.wait(for: [changed], timeout: 10)
        XCTAssertEqual(result, .completed, XCUIApplication().debugDescription)
    }

    func testDraftAudioPreviewsWithNativeMediaPlayer() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference", "--native-ui-reference-audio"]
        app.launch()
        app.buttons["预览 silence.wav"].tap()
        XCTAssertTrue(app.navigationBars["silence.wav"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["native-media-player"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "无法播放媒体")).firstMatch.exists)
    }

    func testReferenceLandscapeKeepsInputAndSendReachable() {
        let app = reference()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let input = app.descendants(matching: .any)["native-composer-input"]
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 5), .completed)
        XCTAssertTrue(input.isHittable, app.debugDescription)
        input.tap()
        input.typeText("Landscape_QA")
        XCTAssertTrue(app.buttons["native-send"].isHittable, app.debugDescription)
        XCTAssertTrue(app.buttons["native-send"].isEnabled)
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
