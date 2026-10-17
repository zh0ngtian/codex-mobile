import XCTest

@MainActor
final class NativeUIUITests: XCTestCase {
    private func reference(_ conversation: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [conversation ? "--native-ui-reference-conversation" : "--native-ui-reference"]
        app.launch()
        return app
    }

    private func historyReference(fails: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-history"] + (fails ? ["--native-ui-reference-history-failure"] : [])
        app.launch()
        XCTAssertTrue(app.staticTexts["原消息"].waitForExistence(timeout: 5))
        app.staticTexts["原消息"].press(forDuration: 1)
        app.buttons["编辑"].tap()
        return app
    }

    func testHistoricalEditStaysAtMessageAndCancelKeepsAttachmentsAndComposer() {
        let app = historyReference()
        let input = app.descendants(matching: .any)["native-history-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(input.isHittable)
        XCTAssertGreaterThanOrEqual(input.frame.minY, app.frame.minY)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.frame.maxY)
        XCTAssertTrue(app.buttons["native-history-submit"].isHittable)
        XCTAssertTrue(app.buttons["native-history-cancel"].isHittable)
        XCTAssertFalse(app.navigationBars["编辑历史消息"].exists)
        XCTAssertTrue(app.staticTexts["original.txt"].exists)
        XCTAssertTrue(app.staticTexts["后续对话仍在原位置"].exists)
        input.tap(); input.typeText(" 已编辑\n第二行")
        XCTAssertTrue((input.value as? String)?.contains("第二行") == true)
        capture("历史编辑-原位", app: app)
        app.buttons["native-history-cancel"].tap()
        XCTAssertFalse(input.exists)
        XCTAssertTrue(app.staticTexts["原消息"].exists)
        XCTAssertTrue(app.staticTexts["original.txt"].exists)
        let composer = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertEqual(composer.value as? String, "普通输入草稿")
    }

    func testHistoricalEditConfirmationReturnsInlineThenSavesAndResends() {
        let app = historyReference()
        let input = app.descendants(matching: .any)["native-history-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(input.isHittable)
        XCTAssertGreaterThanOrEqual(input.frame.minY, app.frame.minY)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.frame.maxY)
        XCTAssertTrue(app.buttons["native-history-submit"].isHittable)
        XCTAssertTrue(app.buttons["native-history-cancel"].isHittable)
        input.tap(); input.typeText(" 新要求")
        let draft = input.value as? String
        app.buttons["native-history-submit"].tap()
        XCTAssertTrue(app.staticTexts["修改并重新发送将删除此消息之后的对话"].waitForExistence(timeout: 5))
        capture("历史编辑-确认", app: app)
        app.buttons["完成"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 3))
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(app.staticTexts["后续对话仍在原位置"].exists)
        app.buttons["native-history-submit"].tap()
        app.buttons["确认并发送"].tap()
        XCTAssertTrue(app.staticTexts[draft!].waitForExistence(timeout: 3))
        XCTAssertFalse(input.exists)
        XCTAssertFalse(app.staticTexts["后续对话仍在原位置"].exists)
        XCTAssertTrue(app.staticTexts["original.txt"].exists)
    }

    func testHistoricalEditSendFailureKeepsInlineDraftAndAttachment() {
        let app = historyReference(fails: true)
        let input = app.descendants(matching: .any)["native-history-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(input.isHittable)
        XCTAssertGreaterThanOrEqual(input.frame.minY, app.frame.minY)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.frame.maxY)
        XCTAssertTrue(app.buttons["native-history-submit"].isHittable)
        XCTAssertTrue(app.buttons["native-history-cancel"].isHittable)
        input.tap(); input.typeText(" 失败草稿")
        let draft = input.value as? String
        app.buttons["native-history-submit"].tap()
        app.buttons["确认并发送"].tap()
        XCTAssertTrue(app.staticTexts["发送失败，请重试"].waitForExistence(timeout: 3))
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(app.buttons["native-history-submit"].isEnabled)
        XCTAssertTrue(app.staticTexts["original.txt"].exists)
        XCTAssertFalse(app.navigationBars["确认修改历史消息"].exists)
        capture("历史编辑-失败", app: app)
    }

    func testVisualReferenceUsesSameNativeViewsAndIndependentFixture() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual"]
        app.launch()
        XCTAssertTrue(app.staticTexts["说明 Sidechat 支持方式"].waitForExistence(timeout: 5))
        app.buttons["native-sidebar-open"].tap()
        XCTAssertTrue(app.buttons["native-new-conversation-launcher"].exists)
        let hiddenInput = app.descendants(matching: .any)["native-composer-input"]
        // XCTest 对被覆盖的 disabled UIKit 字段仍可返回 isHittable；验证其实际编辑门控。
        XCTAssertFalse(hiddenInput.isEnabled)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Projects"].exists)
        XCTAssertFalse(app.buttons["语音"].exists)
    }

    func testVisualReferenceSidebarLauncherFocusesFreshDraft() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-sidebar"]
        app.launch()
        app.buttons["native-new-conversation-launcher"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.isHittable)
        XCTAssertTrue(app.staticTexts["Hello, let’s get started"].exists)
        XCTAssertFalse(app.staticTexts["简单说一下你是怎么支持 sidechat 的"].exists)
        input.typeText("fresh offline draft")
        XCTAssertTrue(app.buttons["native-send"].isEnabled)
    }

    func testVisualReferenceSidebarPlusOpensFreshAttachmentMenu() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-sidebar"]
        app.launch()
        app.buttons["native-new-conversation-attachment"].tap()
        XCTAssertTrue(app.buttons["Photos"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Files"].exists)
        XCTAssertTrue(app.buttons["Skills and Plugins"].exists)
        XCTAssertTrue(app.buttons["Current Location"].exists)
        XCTAssertFalse(app.buttons["native-attachment-close"].exists)
        capture("原生侧栏-新建并直接打开附件菜单", app: app)
        XCTAssertTrue(app.staticTexts["Hello, let’s get started"].exists)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertFalse(app.buttons["native-send"].isEnabled)
    }

    func testVisualReferenceProjectOmitsNewActionAndRecentKeepsLauncher() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-sidebar"]
        app.launch()
        XCTAssertFalse(app.buttons["native-group-new-visual-project-0"].exists)
        let recent = app.buttons["native-group-new-visual-recent"]
        if !recent.isHittable { app.otherElements["native-sidebar"].scrollViews.firstMatch.swipeUp() }
        recent.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Hello, let’s get started"].exists)
    }

    func testVisualReferenceLauncherArrowIsAnInteractiveFreshDraftAction() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-sidebar"]
        app.launch()
        app.buttons["native-new-conversation-action"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Hello, let’s get started"].exists)
    }

    func testVisualReferenceLargeTextRotationKeepsPortraitComposerAndDraft() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        app.buttons["native-new-thread"].tap()
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        input.typeText("stable draft line one\nline two\nline three\nline four\nline five")
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "native-composer-input").count, 1)
        XCUIDevice.shared.orientation = .landscapeLeft
        let keyboard = app.keyboards.firstMatch
        let keyboardVisible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.frame.width < app.frame.height && keyboard.exists && keyboard.frame.intersects(app.frame) && keyboard.frame.minY < app.frame.maxY - 20
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardVisible], timeout: 8), .completed)
        XCTAssertTrue(input.isHittable)
        XCTAssertTrue((input.value as? String)?.contains("stable draft") == true)
        let send = app.buttons["native-send"]
        let sendReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in send.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [sendReady], timeout: 3), .completed)
        if !send.isHittable {
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.lifetime = .keepAlways
            add(evidence)
            print("Portrait rotation frames: app=\(app.frame) input=\(input.frame) send=\(send.frame) keyboard=\(app.keyboards.firstMatch.frame)")
        }
        XCTAssertTrue(send.isHittable)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.buttons["native-model-menu"].frame.minY, "最大辅助字号下输入不能覆盖工具栏")
        XCTAssertLessThanOrEqual(app.buttons["native-model-menu"].frame.maxY, keyboard.frame.minY + 1)
        XCTAssertLessThanOrEqual(send.frame.maxY, keyboard.frame.minY + 1)
        input.typeText(" tail")
        XCTAssertTrue((input.value as? String)?.contains("tail") == true)
        XCTAssertTrue(app.buttons["native-send"].isEnabled)
    }

    func testComposerNaturallyGrowsScrollsAndShrinksWithoutMaximize() {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-focused"]
        app.launch()
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["native-composer-maximize"].exists)
        let oneLineHeight = input.frame.height
        input.typeText("line one\nline two\nline three")
        let grows = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in input.frame.height > oneLineHeight + 10 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [grows], timeout: 3), .completed)
        capture("原生输入-自然增长", app: app)
        input.typeText(String(repeating: "\nscrolling line", count: 15))
        let cappedHeight = input.frame.height
        input.typeText(String(repeating: "\nextra line", count: 5))
        XCTAssertEqual(input.frame.height, cappedHeight, accuracy: 2, "超限输入在编辑器内部滚动")
        XCTAssertTrue((input.value as? String)?.hasSuffix("extra line") == true)
        XCTAssertTrue(app.buttons["native-send"].isHittable)
        capture("原生输入-超限滚动", app: app)
        let characters = (input.value as? String)?.count ?? 0
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: characters))
        let shrinks = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in input.frame.height <= oneLineHeight + 2 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shrinks], timeout: 3), .completed)
        input.typeText(String(repeating: "natural wrapping text ", count: 12))
        XCTAssertGreaterThan(input.frame.height, oneLineHeight + 10, "软换行也自然增长")
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "native-composer-input").count, 1)
    }

    func testRotationKeepsPortraitAttachmentEditorAndActionsAboveKeyboard() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-audio", "--native-ui-reference-busy"]
        app.launch()
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let oneLineHeight = input.frame.height
        input.typeText("\nsecond\nthird")
        XCTAssertGreaterThan(input.frame.height, oneLineHeight + 10, "附件不能填满预算压制自然增长")
        XCUIDevice.shared.orientation = .landscapeLeft
        let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width < app.frame.height }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 5), .completed)
        for action in [app.buttons["移除 silence.wav"], app.buttons["native-send"], app.buttons["native-stop"]] {
            XCTAssertTrue(action.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            XCTAssertGreaterThanOrEqual(action.frame.minY, 0)
            XCTAssertLessThanOrEqual(action.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        }
        XCTAssertTrue(input.isHittable)
        XCTAssertTrue((input.value as? String)?.contains("third") == true)
        capture("旋转后保持竖屏-附件输入与操作均在键盘上方", app: app)
    }

    func testVisualReferenceConfigurationExposesAuthoritativeValues() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-focused"]
        app.launch()
        XCTAssertTrue(app.buttons["native-model-menu"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["native-model-menu"].value as? String, "GPT-5 Medium")
        XCTAssertEqual(app.buttons["native-model-menu"].label, "GPT-5 · Medium")
        capture("原生输入-模型与推理可见标签", app: app)
        XCTAssertFalse(app.buttons["native-effort-menu"].exists)
        XCTAssertTrue((app.buttons["native-speed-menu"].value as? String)?.contains("Fast Off") == true)
        XCTAssertEqual(app.buttons["native-permission-menu"].value as? String, "Read Only")
        let input = app.descendants(matching: .any)["native-composer-input"]
        input.typeText("configuration draft")
        app.buttons["native-model-menu"].tap()
        XCTAssertTrue(app.buttons["High"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["GPT-5"].exists)
        XCTAssertTrue(app.buttons["GPT-5 Mini"].exists)
        XCTAssertTrue(app.buttons["o3"].exists)
        XCTAssertTrue(app.buttons["Low"].exists)
        XCTAssertTrue(app.buttons["Medium"].exists)
        capture("原生输入-模型推理平级菜单无勾选", app: app)
        app.buttons["High"].tap()
        XCTAssertFalse(app.otherElements["native-model-options"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue((input.value as? String)?.contains("configuration draft") == true)
        XCTAssertEqual(app.buttons["native-model-menu"].value as? String, "GPT-5 High")
        app.buttons["native-model-menu"].tap()
        XCTAssertTrue(app.buttons["GPT-5 Mini"].waitForExistence(timeout: 5))
        app.buttons["GPT-5 Mini"].tap()
        XCTAssertEqual(app.buttons["native-model-menu"].value as? String, "GPT-5 Mini High")
        XCTAssertEqual(app.buttons["native-model-menu"].label, "GPT-5 Mini · High")
        XCTAssertTrue((input.value as? String)?.contains("configuration draft") == true)
        app.buttons["native-speed-menu"].tap()
        capture("原生输入-Fast菜单无勾选", app: app)
        app.buttons["Fast"].tap()
        XCTAssertTrue((app.buttons["native-speed-menu"].value as? String)?.contains("Fast On") == true)
        capture("原生输入-Fast开启", app: app)
        app.buttons["native-speed-menu"].tap()
        app.buttons["Standard"].tap()
        XCTAssertTrue((app.buttons["native-speed-menu"].value as? String)?.contains("Fast Off") == true)
        capture("原生输入-Fast关闭", app: app)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["native-permission-menu"].tap()
        XCTAssertTrue(app.buttons["Full Access"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.otherElements["native-permission-options"].exists)
        XCTAssertTrue(app.buttons["Read Only"].exists)
        XCTAssertTrue(app.buttons["Workspace Write"].exists)
        capture("原生输入-审核系统菜单", app: app)
        app.buttons["Full Access"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue((input.value as? String)?.contains("configuration draft") == true)
    }

    func testBusyComposerLargestTextPortraitKeepsActionsVisible() {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-conversation", "--native-ui-reference-busy", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let send = app.buttons["native-send"]
        let stop = app.buttons["native-stop"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(stop.waitForExistence(timeout: 5), app.debugDescription)
        capture("最大辅助字号-竖屏忙碌输入操作", app: app)
        XCTAssertTrue(send.isHittable, app.debugDescription)
        XCTAssertTrue(stop.isHittable, app.debugDescription)
        for action in [send, stop] {
            XCTAssertGreaterThanOrEqual(action.frame.minX, app.frame.minX, "\(action.identifier) 左边界超出屏幕")
            XCTAssertLessThanOrEqual(action.frame.maxX, app.frame.maxX, "\(action.identifier) 右边界超出屏幕")
        }
    }

    func testContextRingPresentsNativeUsagePopover() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual"]
        app.launch()
        XCTAssertTrue(app.buttons["native-context-usage"].waitForExistence(timeout: 5))
        app.buttons["native-context-usage"].tap()
        XCTAssertTrue(app.staticTexts["Usage and Limits"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "93%")).firstMatch.exists, app.debugDescription)
        XCTAssertTrue(app.staticTexts["Cycle Remaining"].exists)
        XCTAssertTrue(app.staticTexts["Time Remaining"].exists)
        XCTAssertTrue(app.staticTexts["Input Tokens"].exists)
        XCTAssertTrue(app.staticTexts["Output Tokens"].exists)
        XCTAssertTrue(app.staticTexts["100K (Cache hit 80%)"].exists)
        XCTAssertTrue(app.staticTexts["28.5K"].exists)
    }

    func testUsageCardShowsCompactConversationTokenAndLimits() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh"]
        app.launch()
        let trigger = app.buttons["native-context-usage"]
        XCTAssertTrue(trigger.waitForExistence(timeout: 5))
        trigger.tap()
        XCTAssertTrue(app.staticTexts["用量与额度"].waitForExistence(timeout: 5))
        for label in ["上下文余量", "周期剩余", "时间剩余", "输入 Token", "输出 Token", "93%", "72%", "43%", "100K（缓存命中 80%）", "28.5K"] {
            XCTAssertTrue(app.staticTexts[label].exists, label)
        }
        capture("对话用量卡片", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.55)).tap()
        XCTAssertTrue(app.staticTexts["用量与额度"].waitForNonExistence(timeout: 5))
        trigger.tap()
        XCTAssertTrue(app.staticTexts["100K（缓存命中 80%）"].waitForExistence(timeout: 5))
    }

    func testVisualReferencePreviewScreenshots() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh"]
        app.launch()
        XCTAssertTrue(app.buttons["native-context-usage"].waitForExistence(timeout: 5))
        capture("预览对照-对话", app: app)
        app.buttons["native-context-usage"].tap()
        XCTAssertTrue(app.staticTexts["用量与额度"].waitForExistence(timeout: 5))
        capture("预览对照-用量", app: app)
        app.staticTexts["Worked for 24s"].tap()
        XCTAssertTrue(app.staticTexts["用量与额度"].waitForNonExistence(timeout: 5), app.debugDescription)
        let input = app.descendants(matching: .any)["native-composer-input"]
        let inputReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: input)
        XCTAssertEqual(XCTWaiter.wait(for: [inputReady], timeout: 5), .completed, app.debugDescription)
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        input.typeText("请继续说明一下具体的实现步骤。")
        capture("预览对照-聚焦输入", app: app)
        app.buttons["native-model-menu"].tap()
        XCTAssertTrue(app.buttons["High"].waitForExistence(timeout: 5))
        capture("预览对照-模型", app: app)
        app.buttons["High"].tap()
        app.buttons["native-permission-menu"].tap()
        XCTAssertTrue(app.buttons["完全访问"].waitForExistence(timeout: 5))
        capture("预览对照-权限", app: app)
        app.buttons["关闭"].tap()
        app.buttons["native-sidebar-open"].tap()
        XCTAssertTrue(app.buttons["native-sidebar-device-menu"].waitForExistence(timeout: 5))
        capture("预览对照-侧栏", app: app)
        app.buttons["native-sidebar-device-menu"].tap()
        app.buttons["native-settings-open"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 5))
        capture("预览对照-设置", app: app)
    }

    func testReferenceSettingsSubpageAuditScreenshots() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh", "--native-ui-reference-visual-sidebar"]
        app.launch()
        app.buttons["native-sidebar-device-menu"].tap()
        app.buttons["native-settings-open"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "设备")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["DEMO5VYDY4"].waitForExistence(timeout: 5))
        capture("审查-设备", app: app)
        if !app.buttons["添加设备"].isHittable { app.swipeUp() }
        app.buttons["添加设备"].tap()
        XCTAssertTrue(app.secureTextFields.firstMatch.waitForExistence(timeout: 5))
        capture("审查-设备表单", app: app)
        app.buttons["取消"].tap()
        app.buttons["native-settings-back"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "通知")).firstMatch.tap()
        XCTAssertTrue(app.buttons["保存推送设置"].waitForExistence(timeout: 5))
        capture("审查-通知", app: app)
        app.buttons["native-settings-choice-bark"].tap()
        XCTAssertTrue(app.secureTextFields["native-field-bark-url"].waitForExistence(timeout: 5))
        capture("审查-Bark通知", app: app)
    }

    func testDeviceMenuKeepsCompactRowsAndOpensSettings() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh", "--native-ui-reference-visual-sidebar"]
        app.launch()
        app.buttons["native-sidebar-device-menu"].tap()
        XCTAssertTrue(app.staticTexts["连接的设备"].waitForExistence(timeout: 5))
        let settings = app.buttons["native-settings-open"]
        XCTAssertTrue(settings.isHittable)
        XCTAssertLessThanOrEqual(settings.frame.height, 55)
        XCTAssertLessThan(settings.frame.minY, app.frame.midY)
        capture("审查-设备菜单对齐", app: app)
        settings.tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["连接的设备"].exists)
    }

    func testReferenceNotificationsAuditScreenshot() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh", "--native-ui-reference-visual-sidebar"]
        app.launch()
        app.buttons["native-sidebar-device-menu"].tap()
        app.buttons["native-settings-open"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "通知")).firstMatch.tap()
        XCTAssertTrue(app.buttons["保存推送设置"].waitForExistence(timeout: 5))
        capture("审查-通知", app: app)
    }

    func testAttachmentContextMenuKeepsDraftAndFocusAfterCancel() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh", "--native-ui-reference-visual-focused"]
        app.launch()
        let input = app.descendants(matching: .any)["native-composer-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.typeText("保留附件草稿")
        app.buttons["添加附件"].tap()
        XCTAssertTrue(app.buttons["Skill 与插件"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["照片"].isHittable)
        XCTAssertTrue(app.buttons["文件"].isHittable)
        XCTAssertTrue(app.buttons["当前位置"].isHittable)
        XCTAssertFalse(app.buttons["native-attachment-close"].exists)
        capture("审查-附件系统菜单", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue((input.value as? String)?.contains("保留附件草稿") == true)
        app.buttons["native-attachment-menu"].tap()
        XCTAssertTrue(app.buttons["文件"].waitForExistence(timeout: 5), "取消后应可立即重开同一个系统菜单")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    }

    func testProjectDisclosureHidesPagingAndRestoresActions() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-reference-visual", "--native-ui-reference-visual-zh", "--native-ui-reference-visual-sidebar", "--native-ui-reference-project-pagination"]
        app.launch()
        let project = app.buttons["native-group-toggle-visual-project-4"]
        let more = app.buttons["native-group-action-visual-project-4:more"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        XCTAssertEqual(project.value as? String, "已展开")
        XCTAssertTrue(more.exists)
        capture("项目-展开", app: app)
        project.tap()
        XCTAssertEqual(project.value as? String, "已折叠")
        XCTAssertFalse(more.exists)
        XCTAssertFalse(app.buttons["native-navigation-project-child-1"].exists)
        capture("项目-折叠", app: app)
        project.tap()
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        XCTAssertTrue(app.buttons["native-navigation-visual-more"].waitForExistence(timeout: 5))
        XCTAssertFalse(more.exists)
    }

    private func capture(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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
        app.buttons["native-sidebar-search-open"].tap()
        XCTAssertTrue(app.textFields["native-sidebar-search"].exists)
        app.buttons["native-sidebar-device-menu"].tap()
        app.buttons["native-settings-open"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 3))
        app.buttons["native-settings-close"].tap()
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

    func testSettingsInlineLanguageAndChildPageReturnWithinSettings() {
        let app = reference()
        app.buttons["native-sidebar-open"].tap()
        app.buttons["native-sidebar-device-menu"].tap()
        app.buttons["native-settings-open"].tap()
        app.buttons["语言"].tap()
        XCTAssertTrue(app.buttons["跟随系统"].waitForExistence(timeout: 5))
        app.buttons["中文"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].exists)
        app.buttons["设备"].tap()
        XCTAssertTrue(app.staticTexts["设备"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["设置"].tap()
        XCTAssertTrue(app.switches["native-ui-preference"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["native-settings-version"].exists)
        XCTAssertFalse(app.buttons["native-settings-version"].exists)
        XCTAssertFalse(app.buttons["应用更新"].exists)
        app.buttons["native-settings-close"].tap()
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
        app.buttons["native-settings-close"].tap()
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
        // WebKit 对网页 checkbox 和关联标签使用不同 AX 类型，按真实可见标签定位。
        let interfaceToggle = app.webViews.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "使用原生界面")).firstMatch
        XCTAssertTrue(interfaceToggle.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(interfaceToggle.isHittable, app.debugDescription)
        let settingsImage = XCTAttachment(screenshot: app.screenshot())
        settingsImage.name = "非原生界面可见切换开关"; settingsImage.lifetime = .keepAlways; add(settingsImage)
        interfaceToggle.tap()
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
        app.buttons["native-sidebar-device-menu"].tap()
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

    func testReferenceRotationKeepsPortraitInputAndSendReachable() {
        let app = reference()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let input = app.descendants(matching: .any)["native-composer-input"]
        let portrait = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width < app.frame.height }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [portrait], timeout: 5), .completed)
        XCTAssertTrue(input.isHittable, app.debugDescription)
        input.tap()
        input.typeText("Portrait_Rotation_QA")
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
