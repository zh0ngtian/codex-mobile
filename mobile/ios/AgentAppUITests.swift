import XCTest
import UIKit

/// 独立界面夹具及本地网关验收；连接凭证不进入源码或测试附件。
@MainActor
final class AgentAppUITests: XCTestCase {
    func testFirstDeviceButtonKeepsHorizontalLabelAndContrast() {
        // 在独立模拟器的离线无设备夹具执行，不连接网关或创建远端会话。
        for appearance in ["Light", "Dark"] {
            let app = XCUIApplication()
            app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-no-devices-fixture", "-appearance", appearance, "-accent", "Pink", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
            app.launch()
            let back = app.buttons["取消并返回设备列表"]
            if back.waitForExistence(timeout: 3) {
                back.tap()
                XCTAssertTrue(back.waitForNonExistence(timeout: 15))
                app.buttons["完成设备设置"].tap()
            }
            let button = app.buttons.matching(identifier: "devices.addFirst").firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 15))
            assertFirstDeviceButton(button, app: app, appearance: appearance, location: "首页")
            button.tap()
            XCTAssertTrue(app.textFields["device.name"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.textViews["device.address"].exists || app.textFields["device.address"].exists)
            back.tap()
            XCTAssertTrue(back.waitForNonExistence(timeout: 15), "取消后应返回真实设备列表，不能检查弹层后面的按钮")
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 5))
            guard let listButton = app.buttons.matching(identifier: "devices.addFirst").allElementsBoundByIndex.first(where: { $0.isHittable }) else {
                XCTFail("设备列表应显示可操作的添加设备按钮")
                return
            }
            assertFirstDeviceButton(listButton, app: app, appearance: appearance, location: "设备列表")
            app.terminate()
        }
    }

    private func assertFirstDeviceButton(_ button: XCUIElement, app: XCUIApplication, appearance: String, location: String) {
        XCTAssertTrue(button.label.contains("添加设备"))
        XCTAssertTrue(button.isHittable, "截图和尺寸验收必须来自当前可交互页面")
        captureConversation("首台设备-" + location + "-" + appearance, app: app)
        XCTAssertGreaterThan(button.frame.width, button.frame.height * 1.8, "添加设备应为横向图文按钮")
        XCTAssertGreaterThanOrEqual(button.frame.height, 44)
        XCTAssertLessThanOrEqual(button.frame.height, 60, "按钮不能被空状态布局拉成竖向胶囊")
        XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: button.frame, screen: app.frame, light: appearance == "Light"), 15, "图文应与中性填充色保持明暗反差")
    }

    func testSteeredRepliesStayInsideProcessBeforeFinalAnswer() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-steered-replies-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let firstGuide = app.staticTexts["先修复测试。"]
        let secondGuide = app.staticTexts["再检查构建。"]
        let history = app.buttons["commentary-history-toggle"]
        let final = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", "最终回答：完成所有调整。")).firstMatch
        let oldFirst = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", "中途旧回答一")).firstMatch
        let oldSecond = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", "中途旧回答二")).firstMatch
        XCTAssertTrue(final.waitForExistence(timeout: 8))
        XCTAssertEqual(app.buttons.matching(identifier: "commentary-history-toggle").count, 1)
        XCTAssertLessThan(firstGuide.frame.maxY, secondGuide.frame.minY)
        XCTAssertLessThan(secondGuide.frame.maxY, history.frame.minY)
        XCTAssertLessThan(history.frame.maxY, final.frame.minY)
        XCTAssertFalse(oldFirst.exists)
        XCTAssertFalse(oldSecond.exists)
        captureConversation("引导归并-仅最终回答外显", app: app)
        history.tap()
        XCTAssertTrue(oldFirst.waitForExistence(timeout: 5))
        XCTAssertTrue(oldSecond.exists)
        XCTAssertFalse((oldFirst.value as? String)?.contains("**") == true, "旧回答进入过程后继续使用Markdown正文渲染")
        captureConversation("引导归并-过程展开保留旧回答", app: app)
    }

    func testNewConversationRestoresLastMachineAndProject() throws {
        // 只检查未提交的新对话目标，不发送消息，不创建远端测试会话。
        let app = try launchConnectedApp()
        app.buttons["sidebar.askCodex"].tap()
        let computer = app.buttons["new.computer"]
        let project = app.buttons["new.project"]
        XCTAssertTrue(computer.waitForExistence(timeout: 15))
        let rememberedComputer = computer.label
        project.tap()
        let target = app.buttons["codex-mobile"].firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10), "当前验收机器应提供本仓库项目")
        target.tap()
        expectation(for: NSPredicate(format: "label == 'codex-mobile'"), evaluatedWith: project)
        waitForExpectations(timeout: 10)
        app.buttons["header.newConversation"].tap()
        expectation(for: NSPredicate(format: "label == 'codex-mobile'"), evaluatedWith: project)
        waitForExpectations(timeout: 10)
        XCTAssertEqual(computer.label, rememberedComputer)
        captureConversation("新对话-重复新建恢复机器和项目", app: app)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["header.newConversation"].waitForExistence(timeout: 20))
        app.buttons["header.newConversation"].tap()
        expectation(for: NSPredicate(format: "label == 'codex-mobile'"), evaluatedWith: project)
        waitForExpectations(timeout: 15)
        XCTAssertEqual(computer.label, rememberedComputer)
        captureConversation("新对话-重启后恢复机器和项目", app: app)
    }

    func testProjectCollapseResetsFiveRowsButDrawerClosePreservesTen() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-sidebar-polish-fixture", "--agent-sidebar-pagination-fixture", "--agent-sidebar-running-count-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        app.buttons["会话列表"].tap()
        let sixth = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "分页会话 6")).firstMatch
        let more = app.buttons["sidebar.more.project-z"]
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        let firstTitle = app.buttons["分页会话 1"].firstMatch
        XCTAssertTrue(firstTitle.exists)
        let screenshot = app.screenshot().image
        let moreX = try XCTUnwrap(Self.firstTextInkX(screenshot, in: more.frame, screen: app.frame))
        let titleX = try XCTUnwrap(Self.firstTextInkX(screenshot, in: firstTitle.frame, screen: app.frame))
        XCTAssertEqual(moreX, titleX, accuracy: 1.5, "项目分页文字左端应与普通会话名称对齐")
        captureConversation("项目分页-文字左边缘对齐", app: app)
        XCTAssertFalse(sixth.exists, "初次只直接展示五条")
        let pageRows = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "分页会话 "))
        XCTAssertEqual(pageRows.count, 5, "运行会话也必须占首批五条的名额")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.running.")).firstMatch.exists)
        more.tap()
        XCTAssertTrue(sixth.waitForExistence(timeout: 5))
        XCTAssertEqual(pageRows.count, 10)
        app.buttons["drawer.close-surface"].tap()
        app.buttons["会话列表"].tap()
        XCTAssertTrue(sixth.exists, "关闭边栏保留已展开的十条")
        app.buttons["收起项目 Zeta"].tap()
        app.buttons["展开项目 Zeta"].tap()
        XCTAssertFalse(sixth.exists, "显式折叠再展开仅直接显示五条")
        XCTAssertEqual(pageRows.count, 5)
        XCTAssertTrue(more.exists)
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertNotNil(Self.firstTextInkX(app.screenshot().image, in: firstTitle.frame, screen: app.frame), "折叠重开后的首行文字必须实际可见")
        captureConversation("项目分页-折叠后恢复五条", app: app)
    }
    func testReturnToBottomCanInterruptScrolling() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-conversation-long-fixture", "--agent-scroll-diagnostics", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        readEarlierMessages(app, toStart: true)
        let jump = app.buttons["conversation.scrollToBottom"]
        XCTAssertTrue(jump.waitForExistence(timeout: 8))
        let timeline = app.scrollViews["conversation.timeline"]
        let start = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.7))
        let end = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.3))
        start.press(forDuration: 0.01, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
        jump.tap()
        let events = app.staticTexts["scroll.diagnostic-events"]
        XCTAssertTrue(events.label.contains("interrupted:"), "点击应主动中止当前滚动，再启动末尾锚点动画")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: jump)
        waitForExpectations(timeout: 4)
        XCTAssertTrue(Self.hasRenderedConversationText(app.screenshot().image))
        captureConversation("滚动未结束-点击立即回底", app: app)
    }

    func testComposerReferenceToolbarAndBalancedTextInsets() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-submit-fixture", "--agent-permission-menu-fixture", "--agent-fast-fixture", "--agent-composer-reference-fixture", "--agent-multiline-composer-fixture", "--agent-composer-geometry-fixture", "-accent", "Pink", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let input = app.textFields["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        XCTAssertTrue((input.value as? String)?.contains("第三行：检查下方按钮对齐") == true)
        XCTAssertGreaterThan(input.frame.height, 55, "三行文字应自然撑高输入区")
        let controls = ["composer.attachments", "composer.permission", "composer.model", "composer.effort", "composer.fast", "composer.submit"].map { app.buttons[$0] }
        for control in controls {
            XCTAssertTrue(control.exists, "参考图工具行在有内容时应完整显示")
            XCTAssertGreaterThan(control.frame.midY, input.frame.maxY, "工具行应独立位于文字下方")
            XCTAssertEqual(control.frame.midY, controls[0].frame.midY, accuracy: 1)
        }
        for (left, right) in zip(controls, controls.dropFirst()) {
            XCTAssertGreaterThanOrEqual(right.frame.minX, left.frame.maxX - 1)
        }
        let parts = app.staticTexts["composer.geometry"].label.split(separator: ",").compactMap { Double($0) }
        XCTAssertEqual(parts.count, 4)
        if parts.count == 4 {
            let topGap = input.frame.minY - parts[1]
            let bottomGap = parts[1] + parts[3] - controls.last!.frame.maxY
            XCTAssertGreaterThanOrEqual(topGap, 10, "有内容时文字不能贴住输入框上边缘")
            XCTAssertEqual(topGap, bottomGap, accuracy: 2, "输入框顶部与工具行下方留白对齐")
        }
        captureConversation("参考输入栏-外置权限与均衡留白", app: app)
    }

    func testSidebarReopeningPreservesProjectFrame() {
        let app = launchSidebarPolishFixture()
        app.buttons["会话列表"].tap()
        let expanded = app.buttons["收起项目 Zeta"]
        XCTAssertTrue(expanded.waitForExistence(timeout: 5))
        let nextProject = app.buttons["收起项目 Alpha"]
        let initialY = nextProject.frame.minY
        app.buttons["drawer.close-surface"].tap()
        app.buttons["会话列表"].tap()
        XCTAssertTrue(expanded.exists)
        XCTAssertEqual(nextProject.frame.minY, initialY, accuracy: 1, "关闭边栏不能把项目高度归零再展开")
        captureConversation("侧栏重开-项目保持展开", app: app)
    }

    func testAgentAppControlsAreAccessible() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 12), app.debugDescription)
        XCTAssertFalse(app.buttons["管理设备"].exists, "隐藏的网页业务层不应暴露交互节点")
    }

    func testAgentAppSidebarControlsAreAccessible() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 12))
        app.buttons["会话列表"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["sidebar.more"].waitForExistence(timeout: 8), app.debugDescription)
    }

    private func launchConversationFixture(long: Bool = false, resetContext: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if long { app.launchArguments += ["--agent-conversation-long-fixture", "--agent-scroll-diagnostics"] }
        if resetContext { app.launchArguments.append("--agent-conversation-reset-context") }
        app.launch()
        XCTAssertTrue(app.staticTexts["history-request-count"].waitForExistence(timeout: 8))
        return app
    }

    private func selectableText(_ text: String, in app: XCUIApplication) -> XCUIElement {
        app.textViews.matching(NSPredicate(format: "value == %@", text)).firstMatch
    }

    /// 夹具与真实会话都从底部进入；阅读、分页和回底用例先执行真实的上翻手势。
    private func readEarlierMessages(_ app: XCUIApplication, toStart: Bool = false) {
        let timeline = app.scrollViews["conversation.timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 8))
        let question = app.staticTexts["请检查项目上下文。"]
        let offset = app.staticTexts["scroll.diagnostic-offset"]
        let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        for _ in 0..<(toStart ? 12 : 1) {
            if toStart && question.exists && question.isHittable && abs(Double(offset.label) ?? .greatestFiniteMagnitude) <= 2 { return }
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        if toStart {
            XCTAssertTrue(question.isHittable, "分页用例必须先实际滚到首条消息")
            XCTAssertEqual(Double(offset.label) ?? .greatestFiniteMagnitude, 0, accuracy: 2, "分页前必须实际到顶，不能仅凭首消息可见判断")
        }
    }

    func testConversationUsesReferenceHistoryComponentAndTrimmedUserText() {
        let app = launchConversationFixture()
        let question = selectableText("请检查项目上下文。", in: app)
        let progress = selectableText("正在读取项目上下文。", in: app)
        XCTAssertTrue(question.waitForExistence(timeout: 8))
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        XCTAssertLessThan(bubble.frame.height, 45, "单行气泡只占一行正文及上下内边距，尾部空白不增加高度")
        XCTAssertFalse(app.buttons["history.loadEarlier"].exists)
        XCTAssertTrue(app.buttons["commentary-history-toggle"].waitForExistence(timeout: 8))
        XCTAssertFalse(progress.exists)
        let time = app.staticTexts["message.user-time"]
        XCTAssertFalse(time.exists, "发送时间默认隐藏")
        // 点击气泡留白，避免系统正文选择层接管测试点击。
        bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.5)).tap()
        XCTAssertTrue(time.waitForExistence(timeout: 3))
        XCTAssertEqual(time.label, "10月17日 10:43")
        XCTAssertEqual(time.frame.maxX, bubble.frame.maxX, accuracy: 1)
        XCTAssertGreaterThan(time.frame.minY, bubble.frame.maxY, "发送时间显示在气泡右下角外侧")
        bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.5)).tap()
        XCTAssertTrue(time.waitForNonExistence(timeout: 3), "再次单击应隐藏时间")
        XCTAssertTrue(app.staticTexts["10月17日 10:46"].exists, "回复时间使用相同格式且保留原位置")
        captureConversation("历史过程-折叠", app: app)
        app.buttons["commentary-history-toggle"].tap()
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        XCTAssertTrue(selectableText("已检查相关文件，正在整理结果。", in: app).exists)
        XCTAssertTrue(app.staticTexts["10月17日 10:44"].exists)
        XCTAssertTrue(app.staticTexts["10月17日 10:45"].exists)
        captureConversation("历史过程-展开", app: app)
        app.buttons["commentary-history-toggle"].tap()
        XCTAssertFalse(progress.exists)
    }

    func testCompletedDurationMovesToProcessHeader() {
        let app = launchConversationFixture()
        let history = app.buttons["commentary-history-toggle"]
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        XCTAssertTrue(history.label.contains("用时1小时2分钟3秒"), history.label)
        XCTAssertFalse(app.staticTexts["1小时2分钟3秒"].exists, "回复末尾不能重复显示用时")
        XCTAssertTrue(app.staticTexts["message.reply-time"].exists)
        history.tap()
        XCTAssertTrue(app.staticTexts["正在读取项目上下文。"].waitForExistence(timeout: 5))
        captureConversation("用时-过程入口", app: app)
    }

    func testRunningProcessStartsExpandedAndCompletesAboveReply() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-running-history-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let history = app.buttons["commentary-history-toggle"]
        let progress = selectableText("正在读取项目上下文。", in: app)
        XCTAssertTrue(history.waitForExistence(timeout: 8))
        XCTAssertTrue(progress.waitForExistence(timeout: 5), "运行中不点击入口就能看到过程")
        XCTAssertTrue(history.label.contains("执行过程"))
        captureConversation("运行中-过程默认展开", app: app)
        history.tap()
        XCTAssertFalse(progress.exists, "运行中仍可手动收起过程")
        history.tap()
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        app.buttons["conversation.actions"].tap()
        let refresh = app.collectionViews.firstMatch.buttons["刷新"].firstMatch
        XCTAssertTrue(refresh.waitForExistence(timeout: 5))
        refresh.tap()
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        XCTAssertTrue(history.label.contains("用时12秒"))
        XCTAssertFalse(progress.exists, "回合完成后自动折叠")
        let reply = app.textViews.matching(identifier: "assistant.selectable").firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        XCTAssertLessThan(history.frame.maxY, reply.frame.minY, "完成过程入口位于最终回答上方")
        captureConversation("完成后-过程折叠并位于回答上方", app: app)
        history.tap()
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
    }

    func testCommentaryBackfillDoesNotMoveDurationOrReply() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-commentary-backfill-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let summary = app.staticTexts["用时1小时2分钟3秒"]
        let replyTime = app.staticTexts["message.reply-time"]
        let history = app.buttons["commentary-history-toggle"]
        XCTAssertTrue(summary.waitForExistence(timeout: 8))
        XCTAssertTrue(replyTime.exists)
        XCTAssertFalse(history.exists, "没有真实过程内容时仍是用时文字，不能提前显示假展开入口")
        let summaryY = summary.frame.midY
        let replyY = replyTime.frame.minY
        captureConversation("过程回填前-仅用时", app: app)
        app.buttons["conversation.actions"].tap()
        let refresh = app.collectionViews.firstMatch.buttons["刷新"].firstMatch
        XCTAssertTrue(refresh.waitForExistence(timeout: 5))
        refresh.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        print("COMMENTARY_HEADER_LAYOUT", summaryY, history.frame.midY, replyY, replyTime.frame.minY)
        XCTAssertEqual(history.frame.midY, summaryY, accuracy: 1, "箭头补出不能移动用时文字基线")
        XCTAssertEqual(replyTime.frame.minY, replyY, accuracy: 1, "过程数据回填不能让原有正文发生重排")
        captureConversation("过程回填后-稳定展开入口", app: app)
        history.tap()
        XCTAssertTrue(selectableText("正在读取项目上下文。", in: app).waitForExistence(timeout: 5))
        history.tap()
        XCTAssertFalse(selectableText("正在读取项目上下文。", in: app).exists)
    }

    func testUnknownDurationKeepsProcessDisclosure() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-no-duration-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let history = app.buttons["commentary-history-toggle"]
        XCTAssertTrue(history.waitForExistence(timeout: 8))
        XCTAssertTrue(history.label.contains("执行过程"), history.label)
        history.tap()
        XCTAssertTrue(app.staticTexts["正在读取项目上下文。"].waitForExistence(timeout: 5))
        captureConversation("无可靠用时-执行过程", app: app)
    }

    func testSidebarControlHeightsMatchChat() {
        let app = launchSidebarPolishFixture()
        app.buttons["会话列表"].tap()
        let search = app.buttons["sidebar.search"], more = app.buttons["sidebar.more"], chat = app.buttons["sidebar.askCodex"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        print("SIDEBAR_CONTROL_HEIGHTS", search.frame, more.frame, chat.frame)
        XCTAssertEqual(search.frame.height, chat.frame.height, accuracy: 0.5)
        XCTAssertEqual(more.frame.height, chat.frame.height, accuracy: 0.5)
        XCTAssertEqual(more.frame.midY, chat.frame.midY, accuracy: 0.5)
        XCTAssertEqual(search.frame.midY, more.frame.midY, accuracy: 0.5, "搜索移动到底部与更多同排")
        for button in [search, more] {
            XCTAssertEqual(button.frame.width, button.frame.height, accuracy: 0.5, "圆形外框必须保持正方形，避免裁圆后可见直径小于Chat高度")
            XCTAssertGreaterThanOrEqual(min(button.frame.width, button.frame.height), 44)
        }
        XCTAssertLessThan(search.frame.maxX, more.frame.minX, "搜索在更多左边")
        captureConversation("侧栏-三个按钮底部同排", app: app)
    }

    func testDeviceManagerAddsBeyondEightDevices() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-many-devices-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 8))
        app.buttons["会话列表"].tap()
        app.buttons["sidebar.more"].tap()
        app.buttons["sidebar.settings"].tap()
        let devices = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '设备'")).firstMatch
        XCTAssertTrue(devices.waitForExistence(timeout: 5))
        devices.tap()
        XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 5))
        let list = app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
        let add = app.buttons["devices.add"]
        for _ in 0..<6 { if add.isHittable { break }; list.swipeUp() }
        XCTAssertTrue(add.exists)
        XCTAssertTrue(add.isEnabled, "已有12台设备时仍可继续添加")
        captureConversation("设备-超过八台仍可添加", app: app)
    }

    func testUsageCircleIsBlackWithoutContextData() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "-accent", "Black", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let usage = app.buttons["header.usage"]
        XCTAssertTrue(usage.waitForExistence(timeout: 8))
        XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: usage.frame, screen: app.frame), 15, "缺少用量数据也使用黑色圆圈")
        captureConversation("用量-固定黑色", app: app)
    }

    func testAllAccentColorsKeepUsageAndSubmitIconsDistinct() {
        for accent in ["Black", "Blue", "Cyan", "Green", "Lime", "Yellow", "Orange", "Pink", "Magenta", "Purple"] {
            let app = XCUIApplication()
            app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-submit-fixture", "--agent-composer-geometry-fixture", "-accent", accent, "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
            app.launch()
            let usage = app.buttons["header.usage"]
            XCTAssertTrue(usage.waitForExistence(timeout: 8))
            XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: usage.frame, screen: app.frame), 15, accent + " 的用量图标应始终为黑色")
            if let expected = ProcessInfo.processInfo.environment["EXPECTED_BUTTON_BORDERS"] {
                XCTAssertEqual(app.staticTexts["composer.geometry"].value as? String, expected, "核对真实系统Show Borders环境")
            }
            let input = app.textFields["message-input"]
            input.tap(); input.typeText("颜色检查")
            let submit = app.buttons["composer.submit"]
            XCTAssertTrue(submit.isEnabled)
            let light = ["Black", "Blue", "Pink", "Magenta", "Purple"].contains(accent)
            XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: submit.frame, screen: app.frame, light: light), 15, accent + " 的发送图标应与底色可辨")
            captureConversation("强调色-" + accent, app: app)
            app.terminate()
        }
    }

    private static func iconInkPixels(_ image: UIImage, element: CGRect, screen: CGRect, light: Bool = false) -> Int {
        guard let source = image.cgImage else { return 0 }
        let scale = CGFloat(source.width) / screen.width
        let icon = CGRect(x: (element.midX - 10) * scale, y: (element.midY - 10) * scale, width: 20 * scale, height: 20 * scale)
        guard let cropped = source.cropping(to: icon) else { return 0 }
        let width = 40, height = 40
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        let count = stride(from: 0, to: bytes.count, by: 4).filter { light ? (bytes[$0] > 235 && bytes[$0 + 1] > 235 && bytes[$0 + 2] > 235) : (bytes[$0] < 50 && bytes[$0 + 1] < 50 && bytes[$0 + 2] < 50) }.count
        print("ICON_INK_PIXELS", count, light, element)
        return count
    }

    func testSteeringStatusIsNotDisplayedAsDuration() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-steering-status-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "value == %@", "正在引导的消息")).firstMatch.waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["用时正在引导"].exists)
        captureConversation("业务状态-不显示为耗时", app: app)
    }

    private func launchInteractionFixture(_ flag: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", flag, "-accent", "Black", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.staticTexts["history-request-count"].waitForExistence(timeout: 8))
        return app
    }

    func testReturnToBottomUsesContinuousMotion() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-conversation-long-fixture", "--agent-scroll-diagnostics", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        readEarlierMessages(app)
        let button = app.buttons["conversation.scrollToBottom"]
        XCTAssertTrue(button.waitForExistence(timeout: 8))
        button.tap()
        let trace = app.staticTexts["scroll.diagnostic-return"].label.split(separator: ",").compactMap { Double($0) }
        print("RETURN_OFFSETS", trace)
        XCTAssertGreaterThan(trace.count, 3, "回到底部必须经过连续的中间位置")
        XCTAssertGreaterThanOrEqual(Int(app.staticTexts["scroll.diagnostic-return-ms"].label) ?? 0, 350, "回底按主分支约0.55秒动画连续滚动，不能快速跳转")
        XCTAssertTrue(Self.hasRenderedConversationText(app.screenshot().image), "动画结束不能出现空白")
        captureConversation("回到底部-连续动画", app: app)
    }

    func testRunningReturnToBottomKeepsAnimationDuringOutput() { assertRunningReturn(streaming: true) }
    func testRunningReturnToBottomWithoutNewOutput() { assertRunningReturn(streaming: false) }

    private func assertRunningReturn(streaming: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-conversation-long-fixture", "--agent-running-scroll-fixture", "--agent-scroll-diagnostics", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if !streaming { app.launchArguments.append("--agent-no-stream-fixture") }
        app.launch()
        readEarlierMessages(app)
        let button = app.buttons["conversation.scrollToBottom"]
        XCTAssertTrue(button.waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["composer.submit"].label == "停止")
        button.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: button)
        waitForExpectations(timeout: 8)
        let trace = app.staticTexts["scroll.diagnostic-return"].label.split(separator: ",").compactMap { Double($0) }
        let elapsed = Int(app.staticTexts["scroll.diagnostic-return-ms"].label) ?? 0
        print("RUNNING_RETURN_OFFSETS", trace, "ELAPSED", elapsed, "EVENTS", app.staticTexts["scroll.diagnostic-events"].label)
        XCTAssertGreaterThan(trace.count, 5, "持续输出期间回底也必须经过连续中间位置")
        XCTAssertGreaterThanOrEqual(elapsed, 350, "约0.55秒回底动画不能被持续输出替换成瞬移")
        if let start = trace.first, let end = trace.last, end > start {
            let largestStep = zip(trace, trace.dropFirst()).map { $1 - $0 }.max() ?? 0
            XCTAssertLessThan(largestStep / (end - start), 0.3, "不能在最后一次位置更新补跳过大段距离")
        }
        if streaming {
            let offset = app.staticTexts["scroll.diagnostic-offset"]
            let previous = Double(offset.label) ?? 0
            expectation(for: NSPredicate { _, _ in (Double(offset.label) ?? 0) > previous + 20 }, evaluatedWith: offset)
            waitForExpectations(timeout: 4)
            XCTAssertFalse(button.exists, "到达底部后应继续跟随持续输出")
            let timeline = app.scrollViews["conversation.timeline"]
            let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.3))
            let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.7))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
            XCTAssertTrue(button.waitForExistence(timeout: 3), "用户开始阅读旧内容后应取消跟随")
            let readingOffset = Double(offset.label) ?? 0
            let deadline = Date().addingTimeInterval(0.6)
            expectation(for: NSPredicate { _, _ in Date() >= deadline }, evaluatedWith: app)
            waitForExpectations(timeout: 2)
            XCTAssertEqual(Double(offset.label) ?? 0, readingOffset, accuracy: 4, "后续输出不能抢回阅读位置")
            button.tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: button)
            waitForExpectations(timeout: 8)
        }
        XCTAssertTrue(Self.hasRenderedConversationText(app.screenshot().image))
        captureConversation("运行中回底-持续输出的连续动画", app: app)
    }

    func testHistoryEditAutomaticallyFocusesAndShowsContrastingSave() {
        let app = launchInteractionFixture("--agent-edit-history-fixture")
        app.otherElements["message.user-bubble"].firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).press(forDuration: 1)
        app.buttons["编辑"].tap()
        let editor = app.descendants(matching: .any).matching(identifier: "history.editor").firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), "编辑时自动聚焦并弹出键盘")
        if app.keyboards.firstMatch.exists { XCTAssertLessThan(editor.frame.maxY, app.keyboards.firstMatch.frame.minY) }
        let save = app.buttons["保存并重发"]
        XCTAssertTrue(save.isHittable)
        XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: save.frame, screen: app.frame, light: true), 15, "重发文字与黑色按钮底色必须可辨")
        captureConversation("历史编辑-焦点与按钮", app: app)
    }

    func testCurrentSidebarConversationHasNoHighlight() {
        let app = launchInteractionFixture("--agent-sidebar-polish-fixture")
        app.buttons["会话列表"].tap()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "对话界面回归")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let panel = app.otherElements["sidebar.panel"]
        let image = app.screenshot().image
        let current = Self.sampleRGB(image, point: CGPoint(x: 180, y: row.frame.midY), screen: app.frame)
        let canvas = Self.sampleRGB(image, point: CGPoint(x: 180, y: panel.frame.maxY - 120), screen: app.frame)
        for index in 0..<3 { XCTAssertEqual(Double(current[index]), Double(canvas[index]), accuracy: 3, "当前会话背景应与侧栏相同") }
        captureConversation("侧栏-取消当前高亮", app: app)
    }

    func testPortraitThumbnailStaysInsideItsContainer() {
        let app = launchInteractionFixture("--agent-portrait-thumbnail-fixture")
        let card = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.attachment.'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        let inside = CGPoint(x: app.staticTexts["竖屏测试.png"].frame.minX - 30, y: card.frame.midY)
        let loaded = NSPredicate { _, _ in Self.sampleRGB(app.screenshot().image, point: inside, screen: app.frame)[0] > 200 && Self.sampleRGB(app.screenshot().image, point: inside, screen: app.frame)[1] < 80 }
        expectation(for: loaded, evaluatedWith: card); waitForExpectations(timeout: 8)
        let padding = Self.sampleRGB(app.screenshot().image, point: CGPoint(x: inside.x, y: inside.y - 24), screen: app.frame)
        XCTAssertGreaterThan(padding[1], 180, "竖图不能溢出42pt缩略图覆盖容器内边距")
        captureConversation("竖屏图片-缩略图裁剪", app: app)
    }

    func testRunningCommentaryHasOnlyOneTimestamp() {
        let app = launchInteractionFixture("--agent-duplicate-time-fixture")
        XCTAssertTrue(app.staticTexts["10月18日 10:44"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textViews.matching(NSPredicate(format: "value == %@", "2026-10-18 10:44")).firstMatch.exists, "运行中的commentary不能再显示旧的正文时间块")
        captureConversation("运行中commentary-单一时间", app: app)
    }

    private static func sampleRGB(_ image: UIImage, point: CGPoint, screen: CGRect) -> [Int] {
        guard let source = image.cgImage else { return [0, 0, 0] }
        let scale = CGFloat(source.width) / screen.width
        guard let crop = source.cropping(to: CGRect(x: point.x * scale - 2, y: point.y * scale - 2, width: 4, height: 4)) else { return [0, 0, 0] }
        var bytes = [UInt8](repeating: 0, count: 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return bytes.prefix(3).map(Int.init)
    }

    func testHistoryRequiresAnotherPullAndPreservesReadingAnchor() {
        let app = launchConversationFixture(long: true)
        let timeline = app.scrollViews["conversation.timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))
        let counter = app.staticTexts["history-request-count"]
        XCTAssertEqual(counter.label, "0", "初始布局不加载")
        let question = app.staticTexts["请检查项目上下文。"]
        let header = app.buttons["header.usage"]
        let headerY = header.frame.minY
        let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        readEarlierMessages(app, toStart: true)
        XCTAssertEqual(counter.label, "0", "第一次到顶及同一手势下拉不加载")
        let priorY = question.frame.minY
        captureConversation("首次下拉-未加载", app: app)
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        expectation(for: NSPredicate(format: "label == '1'"), evaluatedWith: counter)
        waitForExpectations(timeout: 8)
        XCTAssertTrue(question.isHittable)
        expectation(for: NSPredicate { _, _ in abs(question.frame.minY - priorY) < 35 }, evaluatedWith: question)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(question.frame.minY, priorY, accuracy: 35, "前插历史后应保留原阅读位置")
        captureConversation("二次下拉-阅读锚点", app: app)
        XCTAssertTrue(header.isHittable)
        XCTAssertEqual(header.frame.minY, headerY, accuracy: 1, "加载历史不应移动固定页头")
        XCTAssertEqual(question.frame.minY, priorY, accuracy: 35, "最终布局应保持阅读位置")
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        XCTAssertEqual(counter.label, "1", "没有更多历史不重复加载")
    }

    private func captureConversation(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func launchSidebarPolishFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-sidebar-polish-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.staticTexts["history-request-count"].waitForExistence(timeout: 8))
        return app
    }

    func testSidebarReferenceLayoutAndLeftModelLabel() {
        let app = launchSidebarPolishFixture()
        app.buttons["会话列表"].tap()
        XCTAssertTrue(app.buttons["sidebar.search"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["关注"].exists)
        XCTAssertFalse(app.staticTexts["项目"].exists)
        let chat = app.buttons["sidebar.askCodex"]
        let more = app.buttons["sidebar.more"]
        XCTAssertTrue(more.exists)
        XCTAssertFalse(app.staticTexts["Codex"].exists)
        XCTAssertFalse(app.staticTexts["界面夹具"].exists)
        XCTAssertFalse(app.buttons["设置"].exists, "设置只在省略号菜单内显示")
        XCTAssertLessThan(chat.frame.maxX, more.frame.minX)
        XCTAssertEqual(chat.frame.midY, more.frame.midY, accuracy: 2)
        XCTAssertEqual(app.buttons["sidebar.search"].frame.midY, more.frame.midY, accuracy: 1)
        captureConversation("侧栏-参考展开布局", app: app)
        more.tap()
        XCTAssertTrue(app.buttons["草稿箱"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["刷新"].exists)
        XCTAssertFalse(app.buttons["全部设备"].exists, "侧栏菜单仅保留具体设备选项")
        captureConversation("侧栏-底部省略号菜单", app: app)
        app.buttons["设置"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
        app.buttons["settings.close"].tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.3)).tap()
        app.textFields["message-input"].tap()
        let permissions = app.buttons["权限模式"]
        let model = app.buttons["composer.model"]
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        let fast = app.buttons["composer.fast"]
        XCTAssertEqual(model.frame.minX - permissions.frame.maxX, 6, accuracy: 1)
        XCTAssertGreaterThan(fast.frame.minX, app.buttons["composer.effort"].frame.maxX)
        XCTAssertGreaterThan(app.buttons["composer.effort"].frame.minX, model.frame.maxX)
        captureConversation("输入栏-模型靠左", app: app)
    }

    func testSidebarTopRefreshMatchesMoreButtonAndRunsRefresh() {
        let app = launchSidebarPolishFixture()
        app.buttons["会话列表"].tap()
        let refresh = app.buttons["sidebar.refreshTop"]
        XCTAssertTrue(refresh.waitForExistence(timeout: 5), "侧栏右上角直接提供刷新")
        guard refresh.exists else { return }
        let more = app.buttons["sidebar.more"]
        XCTAssertEqual(refresh.frame.midX, more.frame.midX, accuracy: 1)
        XCTAssertEqual(refresh.frame.width, more.frame.width, accuracy: 1)
        XCTAssertEqual(refresh.frame.height, more.frame.height, accuracy: 1)
        XCTAssertLessThan(refresh.frame.maxY, app.frame.height / 4)
        captureConversation("侧栏-顶部刷新与更多对齐", app: app)
        refresh.tap()
        XCTAssertTrue(app.staticTexts["navigation-refresh-count:1"].waitForExistence(timeout: 5), "复用真实 navigation.refresh 命令")
        XCTAssertTrue(more.isHittable, "刷新后保留侧栏")
    }

    func testConversationEntryDoesNotInheritSidebarAnimation() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-sidebar-polish-fixture", "--agent-entry-transition-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["会话列表"].waitForExistence(timeout: 8))
        app.buttons["会话列表"].tap()
        let thread = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND value == %@", "sidebar.conversation.", "已关注")).firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 5))
        thread.tap()
        let probe = app.descendants(matching: .any).matching(identifier: "entry.animation").firstMatch
        XCTAssertTrue(probe.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "value == %@ OR value == %@", "none", "fading"), evaluatedWith: probe)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(probe.value as? String, "none", "进入会话不能继承侧栏动画；否则新旧页面会产生半透明叠帧")
        XCTAssertTrue(app.textViews["assistant.selectable"].waitForExistence(timeout: 5))
        captureConversation("会话进入-无透明度转场", app: app)
    }

    func testSidebarRespondsToHorizontalGestures() {
        let app = launchSidebarPolishFixture()
        let openFrom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.45))
        let openTo = app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.45))
        openFrom.press(forDuration: 0.05, thenDragTo: openTo, withVelocity: .slow, thenHoldForDuration: 0.1)
        let sidebar = app.otherElements["sidebar.panel"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 5))
        XCTAssertEqual(sidebar.frame.width / app.frame.width, 0.8, accuracy: 0.02)
        // 主页面作为整块表面向右移动，原来的按钮不会消失或留在原位。
        let surface = app.buttons["drawer.close-surface"]
        XCTAssertEqual(surface.frame.minX / app.frame.width, 0.8, accuracy: 0.025)
        captureConversation("手势展开-主界面圆角阴影", app: app)
        let closeFrom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.45))
        let closeTo = app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.45))
        closeFrom.press(forDuration: 0.05, thenDragTo: closeTo, withVelocity: .slow, thenHoldForDuration: 0.1)
        expectation(for: NSPredicate { _, _ in !app.buttons["sidebar.more"].isHittable }, evaluatedWith: sidebar)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.buttons["会话列表"].isHittable)
        captureConversation("手势收起-恢复主界面", app: app)
    }

    func testDelayedLongReportShowsBottomAfterInitialLayout() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-delayed-report-fixture", "--agent-scroll-diagnostics", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "conversation.loading").firstMatch.waitForExistence(timeout: 3), "详情尚未返回时显示中性的加载提示，不能只有白屏")
        let replyTime = app.staticTexts.matching(identifier: "message.reply-time").matching(NSPredicate(format: "label != %@", "10月17日 10:46")).firstMatch
        XCTAssertTrue(replyTime.waitForExistence(timeout: 10))
        let deadline = Date().addingTimeInterval(2)
        let visible = NSPredicate { _, _ in Date() >= deadline && replyTime.isHittable && replyTime.frame.minY > 120 && replyTime.frame.maxY < app.frame.height - 50 }
        expectation(for: visible, evaluatedWith: app)
        waitForExpectations(timeout: 12)
        captureConversation("长报告-首次加载到底部", app: app)
        XCTAssertTrue(Self.hasRenderedConversationText(app.screenshot().image), "实际正文区域必须有文字像素")
        XCTAssertFalse(app.buttons["conversation.scrollToBottom"].exists)
    }

    func testPinnedConversationRepeatedEntryRemainsVisible() throws {
        let app = try launchConnectedApp(extraLaunchArguments: ["--agent-entry-diagnostics"])
        let refresh = app.buttons["sidebar.refreshTop"]
        XCTAssertTrue(refresh.waitForExistence(timeout: 5))
        refresh.tap()
        XCTAssertTrue(app.buttons["sidebar.more"].isHittable, "真实刷新完成后保留侧栏")
        let pinned = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND value == %@", "sidebar.conversation.", "已关注")).firstMatch
        XCTAssertTrue(pinned.waitForExistence(timeout: 15))
        let target = pinned.identifier
        for index in 1...4 {
            if index > 1 {
                app.buttons["header.newConversation"].tap()
                app.buttons["会话列表"].tap()
            }
            app.buttons.matching(identifier: target).firstMatch.tap()
            let timeline = app.scrollViews["conversation.timeline"]
            XCTAssertTrue(timeline.waitForExistence(timeout: 15))
            let deadline = Date().addingTimeInterval(2)
            let visible = NSPredicate { _, _ in
                Date() >= deadline && Self.hasRenderedConversationText(app.screenshot().image)
            }
            expectation(for: visible, evaluatedWith: app)
            waitForExpectations(timeout: 15)
            let probe = app.descendants(matching: .any).matching(identifier: "entry.animation").firstMatch
            XCTAssertTrue(probe.waitForExistence(timeout: 5))
            expectation(for: NSPredicate(format: "value == %@ OR value == %@", "none", "fading"), evaluatedWith: probe)
            waitForExpectations(timeout: 5)
            XCTAssertEqual(probe.value as? String, "none", "真实会话进入也不能出现透明度闪动")
            captureConversation("真实置顶会话-反复进入\(index)", app: app)
        }
    }

    func testSelectLocationRequestsPermissionBeforeAdding() {
        let app = launchInteractionFixture("--agent-attachment-menu-fixture")
        app.resetAuthorizationStatus(for: .location)
        defer { app.resetAuthorizationStatus(for: .location) }
        app.buttons["添加附件"].tap()
        XCTAssertTrue(app.buttons["当前位置"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["选择当前位置"].exists)
        XCTAssertFalse(app.buttons["添加"].exists)
        app.buttons["当前位置"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let permission = springboard.alerts.firstMatch
        XCTAssertTrue(permission.waitForExistence(timeout: 5), "选择位置就应请求权限，不等待添加")
        captureConversation("选择位置-直接菜单即时权限", app: springboard)
        if permission.buttons["不允许"].exists { permission.buttons["不允许"].tap() }
        else { permission.buttons.firstMatch.tap() }
        XCTAssertFalse(app.staticTexts["我的当前位置"].exists, "未授权不修改输入")
        XCTAssertFalse(app.navigationBars["添加到对话"].exists)
    }

    func testAttachmentPhotoAndFilePickerCancellationPreservesDraft() {
        let app = launchInteractionFixture("--agent-attachment-menu-fixture")
        let input = app.textFields["message-input"]
        input.tap(); input.typeText("取消选择后保留的草稿")
        app.buttons["添加附件"].tap(); app.buttons["选择照片和视频"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == '取消' OR label == 'Cancel'")).firstMatch.waitForExistence(timeout: 8))
        XCTAssertFalse(app.navigationBars["添加到对话"].exists)
        captureConversation("附件-直接照片选择器", app: app)
        app.buttons.matching(NSPredicate(format: "label == '取消' OR label == 'Cancel'")).firstMatch.tap()
        XCTAssertEqual(input.value as? String, "取消选择后保留的草稿")
        app.buttons["添加附件"].tap(); app.buttons["选择文件"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == '取消' OR label == 'Cancel'")).firstMatch.waitForExistence(timeout: 8))
        captureConversation("附件-直接文件选择器", app: app)
        app.buttons.matching(NSPredicate(format: "label == '取消' OR label == 'Cancel'")).firstMatch.tap()
        XCTAssertEqual(input.value as? String, "取消选择后保留的草稿")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.attachment.'")).firstMatch.exists)
    }

    func testPhotoSelectionAutomaticallyImportsIntoComposer() {
        let app = launchInteractionFixture("--agent-attachment-menu-fixture")
        app.buttons["添加附件"].tap(); app.buttons["选择照片和视频"].tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").matching(NSPredicate(format: "NOT (label CONTAINS[c] 'video' OR label CONTAINS '视频')")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 8), app.debugDescription)
        guard photo.exists else { return }
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let add = app.navigationBars["照片"].buttons["Add"]
        XCTAssertTrue(add.waitForExistence(timeout: 5), "使用系统照片选择器的完成按钮")
        add.tap()
        let attachment = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.attachment.'")).firstMatch
        XCTAssertTrue(attachment.waitForExistence(timeout: 15), "系统picker结束后应自动导入，无第二次添加确认")
        XCTAssertFalse(app.navigationBars["添加到对话"].exists)
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: app.buttons["composer.submit"])
        waitForExpectations(timeout: 10)
        captureConversation("附件-照片自动加入输入区", app: app)
    }

    func testPhotoPickerImportsVideoAndImageTogether() {
        let app = launchInteractionFixture("--agent-attachment-menu-fixture")
        app.buttons["添加附件"].tap()
        app.buttons["选择照片和视频"].tap()
        let assets = app.images.matching(identifier: "PXGGridLayout-Info")
        XCTAssertTrue(assets.firstMatch.waitForExistence(timeout: 8))
        let video = assets.matching(NSPredicate(format: "label CONTAINS[c] 'video' OR label CONTAINS '视频'")).firstMatch
        let photo = assets.matching(NSPredicate(format: "NOT (label CONTAINS[c] 'video' OR label CONTAINS '视频')")).firstMatch
        XCTAssertTrue(video.exists, "系统相册中应能选择预先导入的视频：\(app.debugDescription)")
        XCTAssertTrue(photo.exists)
        guard video.exists, photo.exists else { return }
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let add = app.navigationBars["照片"].buttons["Add"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        let attachments = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.attachment.'"))
        expectation(for: NSPredicate { _, _ in attachments.count == 2 }, evaluatedWith: app)
        waitForExpectations(timeout: 20)
        XCTAssertEqual(attachments.count, 2, "图片和视频应在同一批次自动加入输入区")
        XCTAssertTrue(attachments.matching(NSPredicate(format: "label CONTAINS[c] '.mp4' OR label CONTAINS[c] '.mov'")).firstMatch.exists)
        XCTAssertTrue(app.buttons["composer.submit"].isEnabled)
        captureConversation("附件-照片视频混选自动导入", app: app)
    }

    func testLiveReasoningMenuUsesFetchedEnglishEfforts() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.askCodex"].tap()
        let model = app.buttons["composer.model"]
        let effort = app.buttons["composer.effort"]
        XCTAssertTrue(model.waitForExistence(timeout: 15))
        let raw = ProcessInfo.processInfo.environment["CODEX_TEST_EFFORT_CATALOG"]
            ?? ProcessInfo.processInfo.environment["TEST_RUNNER_CODEX_TEST_EFFORT_CATALOG"]
        let data = try XCTUnwrap(raw?.data(using: .utf8), "验收前须从真实model/list拉取期望目录")
        let catalog = try JSONDecoder().decode([String: [String]].self, from: data)
        let modelName = try XCTUnwrap(model.value as? String)
        let expected = try XCTUnwrap(catalog[modelName], "当前模型必须存在于真实目录：\(modelName)")
        XCTAssertFalse(expected.isEmpty)
        XCTAssertTrue(effort.isEnabled)
        let originalValue = effort.value as? String
        effort.tap()
        for value in expected { XCTAssertTrue(app.buttons[value].waitForExistence(timeout: 5), "缺少接口档位：\(value)") }
        let displayed = app.collectionViews.firstMatch.buttons.allElementsBoundByIndex.map(\.label)
        XCTAssertEqual(displayed, expected, "菜单必须精确保留当前模型的真实英文选项及顺序")
        app.buttons[expected.last!].tap()
        expectation(for: NSPredicate(format: "value == %@", expected.last!), evaluatedWith: effort)
        waitForExpectations(timeout: 8)
        captureConversation("真实目录-英文思考强度", app: app)
        if let originalValue, expected.contains(originalValue), originalValue != expected.last {
            effort.tap()
            app.buttons[originalValue].tap()
            expectation(for: NSPredicate(format: "value == %@", originalValue), evaluatedWith: effort)
            waitForExpectations(timeout: 8)
        }
    }

    func testPendingPhotoImportKeepsRunningTaskStoppable() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-attachment-menu-fixture", "--agent-delayed-attachment-import-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        app.buttons["添加附件"].tap(); app.buttons["选择照片和视频"].tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 8)); photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let add = app.navigationBars["照片"].buttons["Add"]
        XCTAssertTrue(add.waitForExistence(timeout: 5), "使用系统照片选择器的完成按钮")
        add.tap()
        let pending = app.staticTexts["正在添加附件…"]
        XCTAssertTrue(pending.waitForExistence(timeout: 3))
        let stop = app.buttons["composer.submit"]
        XCTAssertEqual(stop.label, "停止")
        XCTAssertTrue(stop.isEnabled, "附件ACK等待期间仍应能停止当前任务")
        captureConversation("附件等待-停止可用", app: app)
        stop.tap()
        expectation(for: NSPredicate(format: "label == '发送' AND isEnabled == true"), evaluatedWith: stop)
        waitForExpectations(timeout: 12)
    }

    func testLongModelMenuKeepsScrollPositionDuringSnapshots() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-model-catalog-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.textFields["message-input"].waitForExistence(timeout: 8))
        app.textFields["message-input"].tap()
        XCTAssertTrue(app.buttons["composer.model"].waitForExistence(timeout: 8))
        app.buttons["composer.model"].tap()
        let last = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Catalog Model 59")).firstMatch
        let menu = app.collectionViews.firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5), app.debugDescription)
        for _ in 0..<15 {
            if last.exists && last.isHittable { break }
            menu.swipeUp(velocity: .fast)
        }
        XCTAssertTrue(last.isHittable, "应能滚到模型列表末尾")
        // 等待多次无关业务快照，不应重建菜单并回到顶部。
        let deadline = Date().addingTimeInterval(2)
        let stayedAtBottom = NSPredicate { _, _ in Date() >= deadline && last.exists && last.isHittable }
        let stable = XCTNSPredicateExpectation(predicate: stayedAtBottom, object: app)
        wait(for: [stable], timeout: 5)
        captureConversation("长模型菜单-底部保持", app: app)
        last.tap()
        expectation(for: NSPredicate(format: "value BEGINSWITH %@", "Catalog Model 59"), evaluatedWith: app.buttons["composer.model"])
        waitForExpectations(timeout: 5)
    }

    func testImageHasNoCaptionAndModelUsesMenuWithFast() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-preview-polish-fixture", "--agent-model-efforts-fixture", "--agent-fast-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let image = app.buttons["preview.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 8))
        XCTAssertFalse(image.staticTexts["preview.png"].exists, "图片下方不显示文件名")
        XCTAssertFalse(image.images["arrow.up.left.and.arrow.down.right"].exists)
        image.tap()
        XCTAssertTrue(app.navigationBars["preview.png"].waitForExistence(timeout: 5))
        app.buttons["关闭"].tap()
        app.textFields["message-input"].tap()
        let model = app.buttons["composer.model"]
        let fast = app.buttons["composer.fast"]
        XCTAssertTrue(fast.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(fast.frame.minX, app.buttons["composer.effort"].frame.maxX)
        XCTAssertEqual(fast.value as? String, "普通速度")
        fast.tap()
        XCTAssertEqual(fast.value as? String, "Fast")
        fast.tap()
        XCTAssertEqual(fast.value as? String, "普通速度")
        model.tap()
        XCTAssertTrue(app.buttons["Model B"].waitForExistence(timeout: 5), "点击模型名直接打开原生菜单")
        XCTAssertFalse(app.navigationBars["模型"].exists)
        XCTAssertFalse(app.images["checkmark"].exists, "模型与强度菜单不显示勾选")
        app.buttons["Model B"].tap()
        app.buttons["composer.effort"].tap()
        XCTAssertTrue(app.buttons["High"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Low"].exists, "每个模型只列自己支持的强度")
        captureConversation("原生模型菜单-真实强度档位", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    }

    func testLongUserMessageNeverCollapses() {
        let app = launchInteractionFixture("--agent-long-user-selection-fixture")
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["展开更多"].exists)
        XCTAssertFalse(app.buttons["收起"].exists)
        let text = app.textViews["user.selectable"].firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertTrue((text.value as? String)?.contains("第200行：完整长消息末尾") == true, "UITextView完整保留长消息末尾")
        XCTAssertEqual((text.value as? String)?.split(separator: "\n").count, 200)
        XCTAssertGreaterThan(bubble.frame.height, 260)
        let timeline = app.descendants(matching: .any).matching(identifier: "conversation.timeline").firstMatch
        for _ in 0..<8 {
            if text.frame.maxY > timeline.frame.minY + 20 && text.frame.maxY <= timeline.frame.maxY { break }
            if text.frame.maxY > timeline.frame.maxY { timeline.swipeUp() } else { timeline.swipeDown() }
        }
        XCTAssertGreaterThan(text.frame.maxY, timeline.frame.minY + 20)
        XCTAssertLessThanOrEqual(text.frame.maxY, timeline.frame.maxY, "滚动后第200行真实落在阅读区域内")
        captureConversation("用户气泡-200行完整末尾", app: app)
    }

    func testQueuedMessageActionsShareOneRow() {
        let app = launchInteractionFixture("--agent-queue-controls-fixture")
        let edit = app.buttons["编辑"]
        let cancel = app.buttons["取消排队消息"]
        let steer = app.buttons["改为引导"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5)); XCTAssertTrue(steer.exists)
        XCTAssertEqual(edit.frame.midY, cancel.frame.midY, accuracy: 1)
        XCTAssertEqual(edit.frame.midY, steer.frame.midY, accuracy: 1)
        XCTAssertLessThan(cancel.frame.minX, edit.frame.minX)
        XCTAssertLessThan(edit.frame.maxX, steer.frame.minX)
        captureConversation("队列按钮-同排", app: app)
    }

    func testUserBodyLongPressShowsMessageMenuThenSelectsText() {
        let app = launchInteractionFixture("--agent-edit-history-fixture")
        let body = app.textViews["user.selectable"].firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).press(forDuration: 1)
        XCTAssertTrue(app.buttons["复制"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["编辑"].exists)
        XCTAssertTrue(app.buttons["选择文本"].exists)
        XCTAssertLessThan(app.buttons["复制"].frame.midY, app.buttons["编辑"].frame.midY)
        XCTAssertLessThan(app.buttons["编辑"].frame.midY, app.buttons["选择文本"].frame.midY)
        captureConversation("用户正文长按-消息菜单", app: app)
        app.buttons["选择文本"].tap()
        let copy = app.menuItems.matching(NSPredicate(format: "label IN %@", ["拷贝", "复制", "Copy"])).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
        captureConversation("选择文本-系统手柄菜单", app: app)
        copy.tap()
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).press(forDuration: 1)
        XCTAssertTrue(app.buttons["选择文本"].waitForExistence(timeout: 5), "退出选择后恢复消息菜单")
        app.buttons["编辑"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "history.editor").firstMatch.waitForExistence(timeout: 5))
    }

    func testMigrationTableKeepsColumnsAlignedAndRowsFullyVisible() {
        let app = launchInteractionFixture("--agent-migration-table-fixture")
        let timeline = app.descendants(matching: .any).matching(identifier: "conversation.timeline").firstMatch
        for _ in 0..<8 {
            let header = app.textViews.matching(NSPredicate(format: "value == %@", "部分")).firstMatch
            if header.exists && header.frame.minY > timeline.frame.minY { break }
            timeline.swipeDown()
        }
        let name = app.textViews.matching(NSPredicate(format: "value == %@", "应用入口与构建")).firstMatch
        let detail = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", "建立独立原生 iOS 工程")).firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(detail.exists)
        XCTAssertLessThan(name.frame.width, 180, "短列按自然内容宽度展示")
        XCTAssertLessThanOrEqual(detail.frame.width, 260)
        XCTAssertEqual(name.frame.minY, detail.frame.minY, accuracy: 1)
        XCTAssertGreaterThan(detail.frame.height, 80, "长单元格完整换行，不能退化为单行或截断")
        let next = app.textViews.matching(NSPredicate(format: "value == %@", "通信与协议")).firstMatch
        XCTAssertGreaterThanOrEqual(next.frame.minY, detail.frame.maxY + 20, "下一行必须在最长单元格之后，不能重叠")
        captureConversation("原会话表格-列宽换行与行高", app: app)
        let originalX = detail.frame.minX
        let start = detail.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.2))
        let end = detail.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.2))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertLessThan(detail.frame.minX, originalX - 5, "超宽表格继续支持横向滚动")
        XCTAssertLessThanOrEqual(detail.frame.maxX, app.frame.maxX - 10, "横向滚动后可查看完整右侧内容")
        captureConversation("原会话表格-横向查看右侧", app: app)
    }

    func testTableWrapsLongCellsAndKeepsShortColumnsCompact() {
        let app = launchInteractionFixture("--agent-table-controls-fixture")
        let number = app.textViews.matching(NSPredicate(format: "value == '#' ")).firstMatch
        XCTAssertTrue(number.waitForExistence(timeout: 8))
        XCTAssertLessThan(number.frame.width, 60)
        let long = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", "这段表格正文必须")).firstMatch
        XCTAssertTrue(long.exists)
        XCTAssertGreaterThan(long.frame.height, 28, "表格长内容应恢复换行")
        XCTAssertLessThanOrEqual(long.frame.width, 260)
        XCTAssertTrue(app.scrollViews["markdown.table"].exists)
        captureConversation("表格-长内容恢复换行", app: app)
    }

    func testAttachmentButtonOpensMenuWithoutIntermediateSheet() {
        let app = launchConversationFixture()
        app.buttons["添加附件"].tap()
        XCTAssertTrue(app.buttons["选择照片和视频"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["选择文件"].exists)
        XCTAssertTrue(app.buttons["当前位置"].exists)
        XCTAssertFalse(app.navigationBars["添加到对话"].exists, "加号直接菜单，不先打开附件sheet")
        XCTAssertFalse(app.buttons["添加"].exists)
        captureConversation("附件-直接context菜单", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.25)).tap()
    }

    func testImagePreviewToolbarPositionsAreSwapped() {
        let app = launchInteractionFixture("--agent-preview-polish-fixture")
        app.buttons["preview.png"].tap()
        let close = app.buttons["关闭"]
        let download = app.buttons["下载"]
        XCTAssertTrue(close.waitForExistence(timeout: 8))
        XCTAssertLessThan(download.frame.midX, close.frame.midX)
        captureConversation("图片预览-下载左关闭右", app: app)
        close.tap()
    }

    func testVideoAttachmentPreviewClosesWithoutReopeningPanel() {
        let app = launchInteractionFixture("--agent-video-preview-fixture")
        let attachment = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.attachment.' AND label CONTAINS 'preview.mp4'")).firstMatch
        XCTAssertTrue(attachment.waitForExistence(timeout: 8))
        for attempt in 0..<3 {
            attachment.tap()
            let bar = app.navigationBars["preview.mp4"]
            XCTAssertTrue(bar.waitForExistence(timeout: 8))
            let close = bar.buttons["关闭"]
            let download = bar.buttons["下载"]
            XCTAssertTrue(download.waitForExistence(timeout: 8))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: download)
            waitForExpectations(timeout: 8)
            XCTAssertLessThan(download.frame.midX, close.frame.midX)
            XCTAssertTrue(app.buttons["preview.playback-toggle"].waitForExistence(timeout: 8))
            if attempt == 0 { captureConversation("视频预览-下载左关闭右", app: app) }
            if attempt == 1 { bar.swipeDown() } else { close.tap() }
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: close)
            waitForExpectations(timeout: 5)
            let deadline = Date().addingTimeInterval(4)
            repeat {
                XCTAssertFalse(app.buttons["完成"].exists, "关闭回执延迟期间不得再弹出底层附件页面")
                XCTAssertFalse(app.buttons["关闭"].exists, "关闭后的预览不能被旧快照重新打开")
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            } while Date() < deadline
            XCTAssertTrue(attachment.exists, "预览关闭后保留已选视频")
            XCTAssertEqual(app.textFields["message-input"].value as? String, "视频预览关闭后保留的草稿")
        }
        captureConversation("视频预览-三次关闭直接返回对话", app: app)
    }

    func testInlineImagePreviewAlsoUsesDownloadLeftCloseRight() {
        let app = launchInteractionFixture("--agent-inline-image-preview-fixture")
        let image = app.buttons["查看图片 内联预览图片"]
        XCTAssertTrue(image.waitForExistence(timeout: 8)); image.tap()
        let download = app.buttons["下载原图"]
        let close = app.buttons["关闭"]
        XCTAssertTrue(close.waitForExistence(timeout: 8))
        XCTAssertLessThan(download.frame.midX, close.frame.midX)
        captureConversation("内联图片-下载左关闭右", app: app)
        close.tap()
    }

    func testBusinessConfirmationUsesSmallSystemAlert() {
        let app = launchInteractionFixture("--agent-confirmation-controls-fixture")
        let alert = app.alerts["确认操作"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "业务确认不应呈现整页sheet")
        guard alert.exists else { return }
        XCTAssertLessThan(alert.frame.height, app.frame.height * 0.5)
        captureConversation("归档确认-系统小弹窗", app: app)
        alert.buttons["取消"].tap()
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "value == '已取消'")).firstMatch.waitForExistence(timeout: 5))
    }

    func testApprovalWaitsUntilConfirmationAlertFinishes() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-confirmation-controls-fixture", "--agent-approval-during-confirmation-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let alert = app.alerts["确认操作"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let deadline = Date().addingTimeInterval(7)
        expectation(for: NSPredicate { _, _ in Date() >= deadline }, evaluatedWith: app)
        waitForExpectations(timeout: 9)
        XCTAssertTrue(alert.exists, "新审批到达不能抢走尚未回答的确认弹窗")
        XCTAssertFalse(app.navigationBars["操作审批"].exists)
        guard alert.exists else { return }
        alert.buttons["取消"].tap()
        XCTAssertTrue(app.navigationBars["操作审批"].waitForExistence(timeout: 8), "确认结束后继续呈现已排队审批")
        captureConversation("确认结束-顺序呈现审批", app: app)
    }

    func testConversationHeaderIsCompactAndAligned() {
        let app = launchConversationFixture()
        let drawer = app.buttons["会话列表"]
        let usage = app.buttons["header.usage"]
        let compose = app.buttons["header.newConversation"]
        let actions = app.buttons["conversation.actions"]
        XCTAssertTrue(usage.waitForExistence(timeout: 8))
        XCTAssertLessThanOrEqual(actions.frame.midX - usage.frame.midX, 90)
        for button in [usage, compose, actions] {
            XCTAssertEqual(drawer.frame.midY, button.frame.midY, accuracy: 1)
        }
        captureConversation("导航栏-紧凑同高", app: app)
        actions.tap()
        XCTAssertTrue(app.buttons["复制会话 ID"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["复制 ID"].exists)
    }

    func testPermissionModeUsesContextMenuAndSelectsBusinessOption() {
        let app = launchInteractionFixture("--agent-permission-menu-fixture")
        let input = app.textFields["message-input"]
        input.tap()
        let permission = app.buttons["权限模式"]
        XCTAssertTrue(permission.waitForExistence(timeout: 5))
        permission.tap()
        XCTAssertFalse(app.navigationBars["权限模式"].exists, "权限选择直接使用菜单，不打开sheet")
        let full = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "完全访问权限,")).firstMatch
        XCTAssertTrue(full.waitForExistence(timeout: 5))
        captureConversation("权限模式-原生context菜单", app: app)
        guard full.exists else { return }
        full.tap()
        XCTAssertEqual(permission.value as? String, "完全访问权限")
        permission.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "默认权限,")).firstMatch.tap()
        XCTAssertEqual(permission.value as? String, "默认权限")
        permission.tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.2)).tap()
        XCTAssertFalse(full.exists, "点击其他区域关闭菜单")
        XCTAssertEqual(permission.value as? String, "默认权限", "取消菜单不改变权限")
    }

    func testComposerIconsAreMoreCompact() {
        let app = launchConversationFixture()
        app.textFields["message-input"].tap()
        let add = app.buttons["添加附件"]
        let permission = app.buttons["权限模式"]
        let fast = app.buttons["composer.fast"]
        XCTAssertTrue(fast.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(permission.frame.midX - add.frame.midX, 41)
        XCTAssertEqual(add.frame.height, fast.frame.height, accuracy: 1)
        XCTAssertEqual(permission.frame.height, fast.frame.height, accuracy: 1)
        captureConversation("输入图标-字号与紧凑间距", app: app)
    }

    func testSidebarStatusMarkersFollowNames() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-sidebar-polish-fixture", "-accent", "Pink", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        app.buttons["会话列表"].tap()
        let unread = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "任务 Alpha")).firstMatch
        XCTAssertTrue(unread.waitForExistence(timeout: 5))
        // 标题AX frame可能扩成整行，用行内最右侧的文字或强调色像素定位状态。
        let unreadX = Self.lastInkX(app.screenshot().image, in: unread.frame, screen: app.frame)
        XCTAssertNotNil(unreadX)
        if let unreadX {
            XCTAssertGreaterThan(unreadX - unread.frame.minX, 50)
            XCTAssertLessThan(unreadX - unread.frame.minX, 150, "未读点紧跟短名称，不靠列表最右侧")
        }
        let runningTitle = app.staticTexts["任务 Zeta"]
        let running = app.activityIndicators.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.running.")).firstMatch
        XCTAssertLessThanOrEqual(running.frame.minX - runningTitle.frame.maxX, 12)
        XCTAssertGreaterThanOrEqual(running.frame.minX - runningTitle.frame.maxX, 0)
        captureConversation("未读强调色-会话", app: app)
        app.buttons["收起项目 Alpha"].tap()
        let project = app.buttons["展开项目 Alpha"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        let projectX = Self.lastInkX(app.screenshot().image, in: project.frame, screen: app.frame)
        XCTAssertNotNil(projectX)
        if let projectX { XCTAssertLessThan(projectX - project.frame.minX, 130, "项目未读点紧跟名称") }
        captureConversation("状态标记-紧跟项目与会话名称", app: app)
    }

    private static func lastInkX(_ image: UIImage, in rect: CGRect, screen: CGRect) -> CGFloat? {
        guard let source = image.cgImage else { return nil }
        let scale = CGFloat(source.width) / screen.width
        let sidebarRect = rect.intersection(CGRect(x: 0, y: 0, width: screen.width * 0.8, height: screen.height))
        let area = CGRect(x: sidebarRect.minX * scale, y: sidebarRect.minY * scale, width: sidebarRect.width * scale, height: sidebarRect.height * scale).integral
        guard let cropped = source.cropping(to: area) else { return nil }
        let width = cropped.width, height = cropped.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var last: Int?
        for index in stride(from: 0, to: bytes.count, by: 4) {
            let red = Int(bytes[index]), green = Int(bytes[index + 1]), blue = Int(bytes[index + 2])
            let colored = max(red, green, blue) - min(red, green, blue) > 60
            if (red < 60 && green < 60 && blue < 60) || colored {
                last = max(last ?? 0, (index / 4) % width)
            }
        }
        return last.map { (area.minX + CGFloat($0)) / scale }
    }

    private static func firstTextInkX(_ image: UIImage, in rect: CGRect, screen: CGRect) -> CGFloat? {
        guard let source = image.cgImage else { return nil }
        let scale = CGFloat(source.width) / screen.width
        let area = CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale).integral
        guard let cropped = source.cropping(to: area) else { return nil }
        let width = cropped.width, height = cropped.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var first: Int?
        for index in stride(from: 0, to: bytes.count, by: 4) {
            if bytes[index] < 180, bytes[index + 1] < 180, bytes[index + 2] < 180 {
                first = min(first ?? width, (index / 4) % width)
            }
        }
        return first.map { (area.minX + CGFloat($0)) / scale }
    }

    func testSidebarLongConversationTitleStaysOnOneLine() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-sidebar-polish-fixture", "--agent-sidebar-long-title-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        app.buttons["会话列表"].tap()
        let title = app.staticTexts["这是一条非常长的会话名称，用来验证侧栏始终只有一行并在末尾省略完整内容"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(title.frame.height, 24, "侧栏会话名只占一行")
        let spinner = app.activityIndicators.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.running.")).firstMatch
        XCTAssertTrue(spinner.isHittable)
        captureConversation("侧栏长会话名-单行保留状态", app: app)
    }

    func testSidebarPreservesBusinessProjectOrderAndUsesSpinner() {
        let app = launchSidebarPolishFixture()
        app.buttons["会话列表"].tap()
        let zeta = app.buttons["收起项目 Zeta"]
        let alpha = app.buttons["收起项目 Alpha"]
        let middle = app.buttons["收起项目 Middle"]
        XCTAssertTrue(zeta.waitForExistence(timeout: 5))
        XCTAssertLessThan(zeta.frame.minY, alpha.frame.minY)
        XCTAssertLessThan(alpha.frame.minY, middle.frame.minY)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "运行中")).count, 0)
        XCTAssertFalse(app.staticTexts["未读"].exists, "侧栏保留未读圆点但不显示未读文字")
        XCTAssertTrue(app.activityIndicators.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.running.")).firstMatch.exists, app.debugDescription)
        captureConversation("项目顺序与运行图标", app: app)
    }

    func testReopeningSameConversationReleasesHistoryRequest() {
        let app = launchConversationFixture(long: true, resetContext: true)
        let timeline = app.scrollViews["conversation.timeline"]
        let counter = app.staticTexts["history-request-count"]
        let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        func pull() { from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1) }
        readEarlierMessages(app, toStart: true); pull()
        XCTAssertEqual(counter.label, "1")
        pull(); pull()
        expectation(for: NSPredicate(format: "label == '2'"), evaluatedWith: counter)
        waitForExpectations(timeout: 8)
        XCTAssertFalse(app.progressIndicators["正在加载历史消息"].exists)
    }

    func testReturnToBottomAndNeutralPreviews() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-conversation-long-fixture", "--agent-preview-polish-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        readEarlierMessages(app)
        let jump = app.buttons["conversation.scrollToBottom"]
        XCTAssertTrue(jump.waitForExistence(timeout: 8), "离开底部时应显示回到底部按钮")
        guard jump.exists else { return }
        XCTAssertFalse(app.buttons["展开更多"].exists)
        captureConversation("回到底部-阅读中", app: app)
        jump.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: jump)
        waitForExpectations(timeout: 5)
        let image = app.buttons["preview.png"]
        let file = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "preview.html")).firstMatch
        XCTAssertTrue(image.isHittable)
        XCTAssertTrue(file.isHittable)
        captureConversation("回到底部-预览卡片", app: app)
        file.tap()
        XCTAssertTrue(app.navigationBars["preview.html"].waitForExistence(timeout: 5))
        captureConversation("中性文件预览", app: app)
        app.buttons["关闭"].tap()
        image.tap()
        XCTAssertTrue(app.staticTexts["缩放 100%"].waitForExistence(timeout: 8))
        captureConversation("中性图片预览", app: app)
        app.buttons["关闭"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.navigationBars["preview.png"])
        waitForExpectations(timeout: 5)
        let timeline = app.scrollViews["conversation.timeline"]
        let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.2))
        let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.75))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        XCTAssertTrue(jump.waitForExistence(timeout: 5))
        jump.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: jump)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(image.isHittable)
    }

    private func launchConnectedApp(extraLaunchArguments: [String] = []) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-scroll-diagnostics", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"] + extraLaunchArguments
        app.launch()
        let gateway = ProcessInfo.processInfo.environment["CODEX_TEST_GATEWAY"]
            ?? ProcessInfo.processInfo.environment["TEST_RUNNER_CODEX_TEST_GATEWAY"]
        let name = "验收 Mac"
        func any(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
        let addressField = any("device.address")
        if !addressField.waitForExistence(timeout: 3) {
            XCTAssertTrue(any("header.usage").waitForExistence(timeout: 12))
        }
        if addressField.exists {
            guard let gateway, !gateway.isEmpty else { throw XCTSkip("需要显式配置本地验收网关") }
            let nameField = any("device.name")
            nameField.tap(); nameField.typeText(name)
            addressField.tap(); addressField.typeText(gateway)
            any("device.testAndSave").tap()
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 35))
        }
        if any("settings.close").exists { any("settings.close").tap() }
        if app.buttons["完成设备设置"].exists { app.buttons["完成设备设置"].tap() }
        // 侧栏常驻布局后，节点存在不代表已展开；等待真实可点击状态再操作。
        if !any("sidebar.more").isHittable, app.buttons["会话列表"].isHittable { app.buttons["会话列表"].tap() }
        XCTAssertTrue(any("sidebar.more").waitForExistence(timeout: 15))
        let scopeMenu = any("sidebar.more")
        expectation(for: NSPredicate { _, _ in scopeMenu.isHittable }, evaluatedWith: scopeMenu)
        waitForExpectations(timeout: 5)
        if scopeMenu.value as? String != name {
            scopeMenu.tap()
            let target = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
            XCTAssertTrue(target.waitForExistence(timeout: 10))
            target.tap()
        }
        XCTAssertTrue(any("sidebar.askCodex").waitForExistence(timeout: 12))
        return app
    }

    func testColdStartupSidebarDoesNotFlashUnconfirmedEmptyState() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        for round in 1...3 {
            app.terminate()
            app.launch()
            let open = app.buttons["会话列表"]
            XCTAssertTrue(open.waitForExistence(timeout: 12), "复用模拟器现有设备，导航可用即展开，不能先等待列表就绪")
            open.tap()
            XCTAssertTrue(app.otherElements["sidebar.panel"].waitForExistence(timeout: 5))
            let empty = app.descendants(matching: .any).matching(identifier: "sidebar.empty").firstMatch
            let projectEmpty = app.descendants(matching: .any).matching(NSPredicate(format:
                "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "sidebar.project.empty.", "/codex-mobile")).firstMatch
            let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.conversation."))
            let loading = app.descendants(matching: .any).matching(identifier: "sidebar.loading").firstMatch
            let projectLoading = app.descendants(matching: .any).matching(NSPredicate(format:
                "identifier BEGINSWITH %@", "sidebar.project.loading.")).firstMatch
            let retry = app.descendants(matching: .any).matching(identifier: "sidebar.retry").firstMatch
            // 包含受控慢目录响应后的真实分页，不将观察窗口当作启动耗时门槛。
            let deadline = Date().addingTimeInterval(12)
            var sawConversation = false
            var sawLoading = false
            var observations = 0
            repeat {
                XCTAssertFalse(empty.exists, "已有真实会话的启动查询不能先显示全局暂无会话")
                XCTAssertFalse(projectEmpty.exists, "当前仓库有真实会话，首轮分页前不能显示项目空态")
                XCTAssertTrue(loading.exists || projectLoading.exists || rows.firstMatch.exists || retry.exists,
                    "启动侧栏须呈现加载、真实内容或错误，不能只有未确认空态")
                sawConversation = sawConversation || rows.firstMatch.exists
                sawLoading = sawLoading || loading.exists
                observations += 1
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            } while Date() < deadline
            XCTAssertTrue(sawConversation, "加载后必须呈现现有真实会话，不能用永久加载掩盖空态")
            print("SIDEBAR_COLD_EMPTY_STATE", round, "observations", observations, "loading", sawLoading, "conversation", sawConversation)
        }
    }

    func testProfileCurrentPinnedConversationLoading() throws {
        func value(_ key: String, _ fallback: Int) -> Int {
            Int(ProcessInfo.processInfo.environment[key] ?? ProcessInfo.processInfo.environment["TEST_RUNNER_" + key] ?? "") ?? fallback
        }
        let warmSamples = value("CODEX_PROFILE_WARM_SAMPLES", 10)
        let coldSamples = value("CODEX_PROFILE_COLD_SAMPLES", 3)
        let profileArgs = ["--conversation-load-profile"]
        var app = try launchConnectedApp(extraLaunchArguments: profileArgs)
        let pinned = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND value == %@", "sidebar.conversation.", "已关注"))
        XCTAssertTrue(pinned.firstMatch.waitForExistence(timeout: 15))
        let titles = pinned.allElementsBoundByIndex.map { row in
            row.staticTexts.firstMatch.exists ? row.staticTexts.firstMatch.label : row.label.components(separatedBy: "，")[0]
        }
        XCTAssertFalse(titles.isEmpty)
        print("PROFILE_TARGETS", titles.enumerated().map { "\($0.offset):\($0.element)" })
        func open(_ title: String, index: Int, round: Int, mode: String) {
            if !app.buttons["sidebar.askCodex"].exists { app.buttons["会话列表"].tap() }
            let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND value == %@ AND label BEGINSWITH %@", "sidebar.conversation.", "已关注", title)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 12), title)
            let status = app.staticTexts["load-profile.status"]
            let previous = status.label
            row.tap()
            expectation(for: NSPredicate { _, _ in status.label.hasPrefix("done:") && status.label != previous }, evaluatedWith: status)
            waitForExpectations(timeout: 22)
            print("PROFILE_SAMPLE", mode, index, round, status.label)
            if round == 0 || mode == "cold" {
                XCTAssertTrue(Self.hasRenderedConversationText(app.screenshot().image))
                captureConversation("加载计时-\(mode)-\(index)-\(round)", app: app)
            }
        }
        for round in 0...max(0, warmSamples) {
            for (index, title) in titles.enumerated() { open(title, index: index, round: round, mode: round == 0 ? "warmup" : "warm") }
        }
        if coldSamples > 0 {
            for round in 0..<coldSamples {
                for (index, title) in titles.enumerated() {
                    app = try launchConnectedApp(extraLaunchArguments: profileArgs + ["--profile-cold"])
                    open(title, index: index, round: round, mode: "cold")
                }
            }
        }
    }

    func testProfileRecordedConversationEntryPositions() throws {
        let app = try launchConnectedApp(extraLaunchArguments: ["--conversation-load-profile"])
        let environment = ProcessInfo.processInfo.environment
        let configured = environment["CODEX_ENTRY_POSITION_TITLES"] ?? environment["TEST_RUNNER_CODEX_ENTRY_POSITION_TITLES"]
        let terms: [String]
        if let configured {
            terms = try JSONDecoder().decode([String].self, from: Data(configured.utf8))
            XCTAssertEqual(terms.count, 2, "逐帧对照需要两类明确指定的会话")
        } else { terms = ["修复 iOS 会话闪烁", "按参考图重做 UI 按键"] }
        for round in 0..<5 {
            for (index, term) in terms.enumerated() {
                if !app.buttons["sidebar.more"].isHittable { app.buttons["会话列表"].tap() }
                let expand = app.buttons["展开项目 codex-mobile"]
                if expand.exists { expand.tap() }
                let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "sidebar.conversation.", term)).firstMatch
                for _ in 0..<12 {
                    if row.exists { break }
                    let more = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "sidebar.more.", "/codex-mobile")).firstMatch
                    guard more.waitForExistence(timeout: 8) else { break }
                    more.tap()
                    RunLoop.current.run(until: Date().addingTimeInterval(0.4))
                }
                XCTAssertTrue(row.waitForExistence(timeout: 15), "复现用户录屏中的真实会话")
                guard row.exists else { return }
                let status = app.staticTexts["load-profile.status"]
                let previous = status.label
                row.tap()
                expectation(for: NSPredicate { _, _ in status.label.hasPrefix("done:") && status.label != previous }, evaluatedWith: status)
                waitForExpectations(timeout: 22)
                print("ENTRY_POSITION_SAMPLE", round, index, status.label)
                XCTAssertTrue(Self.hasRenderedConversationText(app.screenshot().image))
                if round == 0 { captureConversation("首屏位置-录屏会话\(index)", app: app) }
            }
        }
    }

    func testUsageLabelsAndMissingCacheDetails() {
        let app = XCUIApplication()
        let base = ["--native-ui-live", "--agent-conversation-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchArguments = base + ["--agent-startup-loading-fixture"]
        app.launch()
        XCTAssertTrue(app.staticTexts["正在连接…"].waitForExistence(timeout: 5))
        captureConversation("启动加载-中性色", app: app)
        app.launchArguments = base + ["--agent-usage-polish-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 5))
        captureConversation("用量圆圈-四分之一", app: app)
        app.buttons["header.usage"].tap()
        XCTAssertTrue(app.staticTexts["额度剩余"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["周期剩余"].exists)
        XCTAssertTrue(app.staticTexts["刷新时间"].exists)
        XCTAssertFalse(app.staticTexts["剩余时间"].exists)
        XCTAssertTrue(app.staticTexts["4d15h (66%)"].exists, app.debugDescription)
        let input = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "12.3K")).firstMatch
        XCTAssertTrue(input.exists)
        XCTAssertFalse(input.label.contains("("))
        XCTAssertFalse(input.label.contains("缓存"))
        captureConversation("额度与无缓存数据", app: app)
        app.launchArguments = base + ["--agent-usage-polish-fixture", "--agent-usage-cache-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 5))
        app.buttons["header.usage"].tap()
        let cached = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "缓存 0%")).firstMatch
        XCTAssertTrue(cached.waitForExistence(timeout: 5), "真实零命中率仍应展示")
    }

    func testAnswerSupportsNativeTextSelection() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-selectable-answer-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let answer = app.textViews["assistant.selectable"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 8))
        XCTAssertTrue((answer.value as? String)?.contains("第二段支持跨段自由选择文字") == true)
        XCTAssertTrue((answer.value as? String)?.contains("Markdown 标题") == true, "相邻段落、标题和列表须能连续选中")
        answer.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.04)).press(forDuration: 1.2)
        XCTAssertTrue(app.menuItems.matching(NSPredicate(format: "label IN %@", ["复制", "Copy"])).firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        captureConversation("回答文字选择与点虚线", app: app)
        app.menuItems.matching(NSPredicate(format: "label IN %@", ["复制", "Copy"])).firstMatch.tap()
        XCTAssertTrue(app.textViews["code.selectable"].exists)
        XCTAssertTrue(app.textViews.matching(identifier: "markdown.selectable").count > 0, "表格正文也应可选择")
        captureConversation("Markdown与代码表格", app: app)
    }

    func testNewConversationProjectUsesNameAndKeepsPathTarget() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-project-name-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let project = app.buttons["new.project"]
        XCTAssertTrue(project.waitForExistence(timeout: 8))
        XCTAssertEqual(project.label, "MyProject")
        project.tap()
        XCTAssertTrue(app.buttons["AnotherProject"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["/Users/test/WorkSpace/AnotherProject"].exists)
        app.buttons["AnotherProject"].tap()
        XCTAssertEqual(project.label, "AnotherProject")
        captureConversation("新对话项目名称", app: app)
    }

    func testPinnedConversationTopToBottomRemainsVisible() throws {
        let app = try launchConnectedApp()
        let pinned = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND value == %@", "sidebar.conversation.", "已关注"))
        XCTAssertTrue(pinned.firstMatch.waitForExistence(timeout: 15), "需要真实关注的会话进行回归")
        let targets = pinned.allElementsBoundByIndex.prefix(3).map { ($0.identifier, $0.label) }
        print("PINNED_SCROLL_TARGETS", targets.map { $0.1 })
        for (index, target) in targets.enumerated() {
            if index > 0 { app.buttons["会话列表"].tap() }
            app.buttons.matching(identifier: target.0).firstMatch.tap()
            let timeline = app.descendants(matching: .any).matching(identifier: "conversation.timeline").firstMatch
            XCTAssertTrue(timeline.waitForExistence(timeout: 20))
            captureConversation("真实关注会话\(index + 1)-首次进入", app: app)
            let initiallyVisible = NSPredicate { _, _ in
                let viewport = CGRect(x: 0, y: 120, width: app.frame.width, height: app.frame.height - 240)
                return app.textViews.matching(identifier: "assistant.selectable").allElementsBoundByIndex.contains {
                    let rect = $0.frame.intersection(viewport)
                    return !rect.isNull && rect.width > 20 && rect.height > 10
                }
            }
            expectation(for: initiallyVisible, evaluatedWith: app)
            waitForExpectations(timeout: 12)
            let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.2))
            let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.85))
            let offset = app.staticTexts["scroll.diagnostic-offset"]
            XCTAssertTrue(offset.waitForExistence(timeout: 5))
            XCTAssertTrue(app.textViews["assistant.selectable"].firstMatch.waitForExistence(timeout: 15))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0.05)
            var stalled = 0
            for step in 0..<40 {
                let before = Int(offset.label) ?? 0
                if before <= 2 { break }
                from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0.05)
                let after = Int(offset.label) ?? 0
                print("PINNED_SCROLL_STEP", step, before, after)
                stalled = abs(after - before) < 2 ? stalled + 1 : 0
                if stalled >= 3 { break }
            }
            XCTAssertLessThanOrEqual(Int(offset.label) ?? 99999, 2, "必须先到真实会话最顶部")
            captureConversation("真实关注会话\(index + 1)-顶部", app: app)
            let historyCount = app.staticTexts["scroll.diagnostic-history"]
            let priorRequests = Int(historyCount.label) ?? 0
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
            print("PINNED_HISTORY_REQUESTS", priorRequests, Int(historyCount.label) ?? 0)
            let jump = app.buttons["conversation.scrollToBottom"]
            XCTAssertTrue(jump.waitForExistence(timeout: 8))
            jump.tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: jump)
            waitForExpectations(timeout: 12)
            // 最终验收直接检查正文区域的实际像素，捕获“AX 节点仍在但页面已白”的故障。
            let visibleText = NSPredicate { _, _ in Self.hasRenderedConversationText(app.screenshot().image) }
            expectation(for: visibleText, evaluatedWith: app)
            waitForExpectations(timeout: 8)
            captureConversation("真实关注会话\(index + 1)-回到底部", app: app)
        }
    }

    private static func hasRenderedConversationText(_ image: UIImage) -> Bool {
        guard let source = image.cgImage,
              let cropped = source.cropping(to: CGRect(x: Double(source.width) * 0.08, y: Double(source.height) * 0.2,
                                                       width: Double(source.width) * 0.84, height: Double(source.height) * 0.58)) else { return false }
        let width = 96, height = 160
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard rendered else { return false }
        let luminances = stride(from: 0, to: bytes.count, by: 4).map { (Int(bytes[$0]) + Int(bytes[$0 + 1]) + Int(bytes[$0 + 2])) / 3 }
        let background = luminances.sorted()[luminances.count / 2]
        let ink = luminances.filter { abs($0 - background) > 80 }.count
        let ratio = Double(ink) / Double(luminances.count)
        print("CONVERSATION_RENDERED_INK", source.width, source.height, background, ratio)
        return ratio > 0.01
    }

    func testLiveSevenDayRefreshInNewConversation() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.askCodex"].tap()
        app.buttons["header.usage"].tap()
        XCTAssertTrue(app.staticTexts["刷新时间"].waitForExistence(timeout: 8))
        let refresh = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "[0-9]+d[0-9]+h \\([0-9]+%\\)")).firstMatch
        XCTAssertTrue(refresh.waitForExistence(timeout: 20), "真实账户七天窗口刷新时间在新对话中也应可见")
        captureConversation("真实网关-新对话七天刷新时间", app: app)
        app.buttons["header.usage"].tap()
    }

    func testHeaderAndOutsideModelDismissal() {
        let app = launchConversationFixture()
        let usage = app.buttons["header.usage"]
        let create = app.buttons["header.newConversation"]
        let actions = app.buttons["conversation.actions"]
        XCTAssertEqual(usage.frame.width, create.frame.width, accuracy: 1)
        XCTAssertEqual(usage.frame.width, actions.frame.width, accuracy: 1)
        XCTAssertEqual(usage.frame.height, actions.frame.height, accuracy: 1)
        let input = app.textFields["message-input"]
        input.tap()
        XCTAssertTrue(app.buttons["composer.model"].waitForExistence(timeout: 5), "聚焦输入后应显示模型入口")
        app.buttons["composer.model"].tap()
        let option = app.buttons["Model B"]
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["模型"].exists)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: option)
        waitForExpectations(timeout: 5)
        captureConversation("原生模型菜单外单击关闭", app: app)
        app.launchArguments.append("--agent-project-name-fixture")
        app.launch()
        XCTAssertEqual(app.buttons["header.usage"].value as? String, "暂无上下文用量")
        captureConversation("新对话全灰圆环", app: app)
    }

    func testReferenceTypographyAndProjectSubtitle() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-reference-type-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let answer = app.textViews["assistant.selectable"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 8))
        XCTAssertTrue((answer.value as? String)?.contains("尤利乌斯·凯撒") == true)
        XCTAssertFalse(app.staticTexts["/Users/test/WorkSpace/AgentApp"].exists)
        XCTAssertTrue(app.staticTexts["AgentApp · 界面夹具"].exists)
        XCTAssertLessThan(app.buttons["composer.submit"].frame.width, 44, "发送按钮视觉尺寸应缩小")
        captureConversation("参考文字-普通与加粗", app: app)
    }

    func testOnlyCommentaryAndModelSpecificEfforts() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-running-commentary-fixture", "--agent-model-efforts-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.staticTexts["正在整理项目。"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["不应显示的工具调用"].exists)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "commentary.separator").count, 2)
        captureConversation("运行过程-只显示commentary与灰线", app: app)
        app.textFields["message-input"].tap()
        let model = app.buttons["composer.model"]
        let effort = app.buttons["composer.effort"]
        effort.tap()
        XCTAssertTrue(app.buttons["Medium"].waitForExistence(timeout: 5))
        app.buttons["Medium"].tap()
        XCTAssertEqual(effort.value as? String, "Medium")
        model.tap()
        app.buttons["Model B"].tap()
        XCTAssertTrue((model.value as? String)?.hasPrefix("Model B") == true)
        effort.tap()
        XCTAssertTrue(app.buttons["High"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Low"].exists)
        XCTAssertFalse(app.sliders.firstMatch.exists, "思考强度使用菜单档位，不再显示滑杆")
        captureConversation("模型独立强度菜单", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    }

    func testSystemTypeAndBoldTextAffectSelectableAnswer() {
        let app = launchConversationFixture()
        let original = app.textViews["assistant.selectable"].firstMatch.frame.height
        app.launchArguments.append("--agent-typography-fixture")
        app.launch()
        let answer = app.textViews["assistant.selectable"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(answer.frame.height, original + 10, "可选择正文必须跟随系统字号与粗体环境重新排版")
        captureConversation("系统大字号和粗体-原生正文", app: app)
    }

    func testUserTimestampTogglePreservesBubbleAndCopy() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-short-question-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        let width = bubble.frame.width
        XCTAssertLessThan(width, 120, "单字用户气泡保持自然文字宽度，不能被UITextView撑满")
        let time = app.staticTexts["message.user-time"]
        XCTAssertFalse(time.exists)
        bubble.tap()
        XCTAssertTrue(time.waitForExistence(timeout: 3))
        XCTAssertEqual(bubble.frame.width, width, accuracy: 1, "显示外侧时间不能撑宽短气泡")
        XCTAssertEqual(time.frame.maxX, bubble.frame.maxX, accuracy: 1)
        captureConversation("短气泡外侧时间与参考色", app: app)
        bubble.tap()
        XCTAssertFalse(time.exists)
        bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).press(forDuration: 1.2)
        let copy = app.buttons["复制"]
        XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
        copy.tap()
        XCTAssertTrue(app.staticTexts["已复制"].waitForExistence(timeout: 3))
        XCTAssertFalse(time.exists, "长按复制不应切换发送时间")
        XCTAssertTrue(app.buttons["用时1小时2分钟3秒"].exists)
    }

    func testUsesSystemNavigationAndSettingsForm() {
        let app = launchConversationFixture()
        XCTAssertTrue(app.navigationBars["对话界面回归"].waitForExistence(timeout: 5), "页头应由真实系统导航栏提供")
        captureConversation("系统导航栏-干净状态", app: app)
        app.buttons["会话列表"].tap()
        app.buttons["sidebar.more"].tap()
        app.buttons["sidebar.settings"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["settings.form"].exists, "设置应使用系统表单")
        captureConversation("系统设置表单", app: app)
        app.buttons["settings.appearance"].tap()
        XCTAssertTrue(app.buttons["深色"].waitForExistence(timeout: 3))
        app.buttons["深色"].tap()
        app.buttons["settings.appearance"].tap()
        app.buttons["浅色"].tap()
        app.buttons["settings.accent"].tap()
        XCTAssertTrue(app.buttons["粉色"].waitForExistence(timeout: 3))
        captureConversation("强调色-预览点与文字间距", app: app)
        app.buttons["粉色"].tap()
        app.buttons["settings.close"].tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.3)).tap()
        XCTAssertTrue(app.navigationBars["对话界面回归"].waitForExistence(timeout: 5))
        let fixtureError = app.staticTexts["此界面夹具不执行真实业务"]
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: fixtureError)
        waitForExpectations(timeout: 5)
        captureConversation("系统导航栏与消息", app: app)
    }

    func testRenameAlertUsesNeutralControlsAndCancelPreservesName() {
        let app = launchConversationFixture()
        app.buttons["conversation.actions"].tap()
        app.buttons["重命名"].tap()
        let alert = app.alerts["重命名会话"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let name = alert.textFields.firstMatch
        XCTAssertEqual(name.value as? String, "对话界面回归")
        name.tap(); name.typeText(" 调整")
        XCTAssertTrue(alert.buttons["保存"].isEnabled)
        captureConversation("重命名-中性弹窗", app: app)
        alert.buttons["取消"].tap()
        XCTAssertTrue(app.navigationBars["对话界面回归"].waitForExistence(timeout: 5))
    }

    func testSubmitPositionMatchesCompactAndExpandedReference() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-composer-geometry-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let geometry = app.staticTexts["composer.geometry"]
        XCTAssertTrue(geometry.waitForExistence(timeout: 8))
        func surface() -> CGRect {
            let parts = geometry.label.split(separator: ",").compactMap { Double($0) }
            guard parts.count == 4 else { XCTFail("缺少真实输入框范围"); return .zero }
            return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
        }
        let submit = app.buttons["composer.submit"]
        let compact = surface()
        print("COMPOSER_COMPACT", compact, submit.frame)
        XCTAssertEqual(compact.maxX - submit.frame.maxX, 12, accuracy: 1.5)
        XCTAssertEqual(compact.maxY - submit.frame.maxY, 17, accuracy: 1.5)
        XCTAssertGreaterThan(submit.frame.minY, app.textFields["message-input"].frame.maxY)
        captureConversation("发送按钮位置-收起", app: app)
        app.textFields["message-input"].tap()
        XCTAssertTrue(app.buttons["composer.effort"].waitForExistence(timeout: 5))
        let expanded = surface()
        print("COMPOSER_EXPANDED", expanded, submit.frame)
        XCTAssertEqual(expanded.maxX - submit.frame.maxX, 12, accuracy: 1.5)
        XCTAssertEqual(expanded.maxY - submit.frame.maxY, 17, accuracy: 1.5)
        captureConversation("发送按钮位置-展开", app: app)
    }

    func testSendAndStopKeepBusinessActionsWithSystemFeedback() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-submit-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["发送"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["composer.submit"].isEnabled)
        app.buttons["composer.submit"].tap()
        XCTAssertTrue(app.buttons["停止"].waitForExistence(timeout: 5), "发送仍经过原业务命令并切换为运行状态")
        captureConversation("提交触感-发送后的停止入口", app: app)
        app.buttons["composer.submit"].tap()
        XCTAssertTrue(app.buttons["发送"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["composer.submit"].isEnabled, "停止后保留空输入的发送禁用规则")
        captureConversation("提交触感-停止后的禁用发送按钮", app: app)
    }

    func testSystemMenuUsesGatewayEffortValues() {
        let app = launchConversationFixture()
        app.launchArguments.append("--agent-model-efforts-fixture")
        app.launch()
        app.textFields["message-input"].tap()
        let model = app.buttons["composer.model"]
        let effort = app.buttons["composer.effort"]
        XCTAssertTrue(effort.waitForExistence(timeout: 5), "强度应在模型右边单独选择")
        model.tap()
        XCTAssertFalse(app.buttons["High"].exists, "模型菜单只列模型")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        effort.tap()
        XCTAssertTrue(app.buttons["High"].waitForExistence(timeout: 5))
        app.buttons["High"].tap()
        expectation(for: NSPredicate(format: "value == 'High'"), evaluatedWith: effort)
        waitForExpectations(timeout: 5)
        model.tap()
        XCTAssertTrue(app.buttons["Model B"].waitForExistence(timeout: 5))
        app.buttons["Model B"].tap()
        expectation(for: NSPredicate(format: "value BEGINSWITH 'Model B'"), evaluatedWith: model)
        waitForExpectations(timeout: 5)
        effort.tap()
        XCTAssertTrue(app.buttons["High"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Medium"].exists)
        captureConversation("独立强度菜单-当前模型真实档位", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    }

    func testConfigureProvidedGateway() throws {
        let app = try launchConnectedApp()
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "sidebar.more").firstMatch.value as? String, "验收 Mac")
    }

    func testSidebarProjectsCanCollapseAndExpand() {
        let app = launchSidebarPolishFixture()
        app.buttons["会话列表"].tap()
        let collapse = app.buttons["收起项目 Zeta"]
        XCTAssertTrue(collapse.waitForExistence(timeout: 5)); collapse.tap()
        XCTAssertTrue(app.buttons["展开项目 Zeta"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "任务 Zeta")).firstMatch.isHittable, "收起后会话不能被看到或点击")
        app.buttons["展开项目 Zeta"].tap()
        XCTAssertTrue(collapse.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "任务 Zeta")).firstMatch.waitForExistence(timeout: 5))
        captureConversation("项目展开收起动画-恢复展开", app: app)
    }

    func testLiveMessageRoundTripAndArchive() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.askCodex"].tap()
        let input = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        input.tap()
        let marker = "AGENTUI-" + String(UUID().uuidString.prefix(8))
        input.typeText("这是原生客户端验收测试。请先发送一条简短执行进展，再调用工具等待12秒并查询当前工作目录，最后只回复：" + marker + "。只读验证，不要修改文件。")
        let send = app.buttons["composer.submit"]
        XCTAssertTrue(send.isEnabled)
        send.tap()
        let response = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", marker)).firstMatch
        XCTAssertTrue(app.buttons["conversation.actions"].waitForExistence(timeout: 10))
        app.buttons["conversation.actions"].tap()
        let pin = app.buttons["关注"]
        XCTAssertTrue(pin.waitForExistence(timeout: 5))
        if pin.exists { pin.tap() }
        app.buttons["conversation.actions"].tap()
        let unpin = app.buttons["取消关注"]
        XCTAssertTrue(unpin.waitForExistence(timeout: 8), "运行中关注应成功回写")
        XCTAssertFalse(app.staticTexts["会话操作未完成"].exists)
        if unpin.exists { unpin.tap() }
        XCTAssertFalse(app.staticTexts["会话操作未完成"].exists)
        XCTAssertTrue(response.waitForExistence(timeout: 150), "应收到真实网关的模型回复")
        let history = app.buttons["commentary-history-toggle"].firstMatch
        XCTAssertTrue(history.waitForExistence(timeout: 8), "真实执行进展应进入参考历史组件")
        history.tap()
        captureConversation("真实网关-执行过程", app: app)
        app.buttons["conversation.actions"].tap()
        XCTAssertTrue(app.buttons["归档"].waitForExistence(timeout: 8))
        app.buttons["归档"].tap()
        let confirm = app.alerts["确认操作"].buttons["确认"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 8), "普通归档也应二次确认，不能立即移除会话")
        guard confirm.exists else { return } // 旧实现此时已归档本测试新建的会话。
        app.buttons["取消"].tap()
        XCTAssertTrue(response.exists, "取消后保留原会话")
        app.buttons["conversation.actions"].tap(); app.buttons["归档"].tap()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        XCTAssertTrue(app.buttons["sidebar.askCodex"].waitForExistence(timeout: 20))
    }

    func testAgentAppSidebarSearchAndSettings() throws {
        let app = try launchConnectedApp()
        let sidebar = app.otherElements["sidebar.panel"]
        if sidebar.exists {
            XCTAssertEqual(sidebar.frame.width / app.frame.width, 0.8, accuracy: 0.035)
        }
        app.buttons["sidebar.search"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["sidebar.search"].tap()
        app.buttons["sidebar.more"].tap()
        let settings = app.buttons["设置"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["设备"].exists || app.staticTexts["设备"].exists)
        XCTAssertTrue(app.buttons["通知"].exists || app.staticTexts["通知"].exists)
    }

    func testKeepNativeInterfaceEnabledForAcceptance() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.more"].tap()
        app.buttons["sidebar.settings"].tap()
        let accent = app.buttons["settings.accent"]
        XCTAssertTrue(accent.waitForExistence(timeout: 5))
        accent.tap()
        XCTAssertTrue(app.buttons["黑色"].waitForExistence(timeout: 5))
        app.buttons["黑色"].tap()
        let toggle = app.switches["native-ui-preference"]
        for _ in 0..<3 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 8))
        if toggle.value as? String == "0" { toggle.tap() }
        let enabled = NSPredicate(format: "value == '1'")
        expectation(for: enabled, evaluatedWith: toggle)
        waitForExpectations(timeout: 12)
        app.buttons["settings.close"].tap()
        let chat = app.buttons["sidebar.askCodex"]
        XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: chat.frame, screen: app.frame), 500, "直接核对黑色强调色的实际填充")
        chat.tap()
        XCTAssertTrue(app.buttons["header.usage"].waitForExistence(timeout: 5))
        XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: app.buttons["header.usage"].frame, screen: app.frame), 15)
        captureConversation("真实网关-黑色原生界面验收", app: app)
    }
}
