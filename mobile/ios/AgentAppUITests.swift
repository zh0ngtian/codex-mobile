import XCTest

/// 独立界面夹具及本地网关验收；连接凭证不进入源码或测试附件。
@MainActor
final class AgentAppUITests: XCTestCase {
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
        XCTAssertTrue(app.descendants(matching: .any)["sidebar.codexMenu"].waitForExistence(timeout: 8), app.debugDescription)
    }

    private func launchConversationFixture(long: Bool = false, resetContext: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if long { app.launchArguments.append("--agent-conversation-long-fixture") }
        if resetContext { app.launchArguments.append("--agent-conversation-reset-context") }
        app.launch()
        XCTAssertTrue(app.staticTexts["history-request-count"].waitForExistence(timeout: 8))
        return app
    }

    func testConversationUsesReferenceHistoryComponentAndTrimmedUserText() {
        let app = launchConversationFixture()
        let question = app.staticTexts["请检查项目上下文。"]
        XCTAssertTrue(question.waitForExistence(timeout: 8))
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        XCTAssertLessThan(bubble.frame.height, 45, "单行气泡只占一行正文及上下内边距，尾部空白不增加高度")
        XCTAssertFalse(app.buttons["history.loadEarlier"].exists)
        XCTAssertTrue(app.buttons["commentary-history-toggle"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["正在读取项目上下文。"].exists)
        let time = app.staticTexts["message.user-time"]
        XCTAssertFalse(time.exists, "发送时间默认隐藏")
        bubble.tap()
        XCTAssertTrue(time.waitForExistence(timeout: 3))
        XCTAssertEqual(time.label, "10月17日 10:43")
        XCTAssertEqual(time.frame.maxX, bubble.frame.maxX, accuracy: 1)
        XCTAssertGreaterThan(time.frame.minY, bubble.frame.maxY, "发送时间显示在气泡右下角外侧")
        bubble.tap()
        XCTAssertFalse(time.exists, "再次单击应隐藏时间")
        XCTAssertTrue(app.staticTexts["10月17日 10:46"].exists, "回复时间使用相同格式且保留原位置")
        captureConversation("历史过程-折叠", app: app)
        app.buttons["commentary-history-toggle"].tap()
        XCTAssertTrue(app.staticTexts["正在读取项目上下文。"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["已检查相关文件，正在整理结果。"].exists)
        XCTAssertTrue(app.staticTexts["10月17日 10:44"].exists)
        XCTAssertTrue(app.staticTexts["10月17日 10:45"].exists)
        captureConversation("历史过程-展开", app: app)
        app.buttons["commentary-history-toggle"].tap()
        XCTAssertFalse(app.staticTexts["正在读取项目上下文。"].exists)
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
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
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
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-sidebar-polish-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
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
        let settings = app.buttons["sidebar.settings"]
        XCTAssertTrue(settings.exists)
        XCTAssertLessThan(chat.frame.maxX, settings.frame.minX)
        XCTAssertEqual(chat.frame.midY, settings.frame.midY, accuracy: 2)
        XCTAssertLessThan(app.buttons["sidebar.search"].frame.maxY, app.buttons["收起项目 Zeta"].frame.minY)
        captureConversation("侧栏-参考展开布局", app: app)
        settings.tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
        app.buttons["settings.close"].tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.3)).tap()
        app.textFields["message-input"].tap()
        let permissions = app.buttons["权限模式"]
        let model = app.buttons["composer.model"]
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        let fast = app.buttons["composer.fast"]
        XCTAssertLessThan(fast.frame.minX - permissions.frame.maxX, 8)
        XCTAssertLessThan(model.frame.minX - fast.frame.midX, 30, "闪电和模型名应紧随权限图标，不能被推到右侧")
        captureConversation("输入栏-模型靠左", app: app)
    }

    func testSidebarRespondsToHorizontalGestures() {
        let app = launchSidebarPolishFixture()
        let openFrom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.45))
        let openTo = app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.45))
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
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: sidebar)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.buttons["会话列表"].isHittable)
        captureConversation("手势收起-恢复主界面", app: app)
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
        XCTAssertLessThan(fast.frame.midX, model.frame.minX)
        XCTAssertEqual(fast.value as? String, "普通速度")
        fast.tap()
        XCTAssertEqual(fast.value as? String, "Fast")
        fast.tap()
        XCTAssertEqual(fast.value as? String, "普通速度")
        model.tap()
        XCTAssertTrue(app.buttons["model.option.model-b"].waitForExistence(timeout: 5), "点击模型名直接打开原生菜单")
        XCTAssertFalse(app.navigationBars["模型"].exists)
        XCTAssertFalse(app.images["checkmark"].exists, "模型与强度菜单不显示勾选")
        app.buttons["model.option.model-b"].tap()
        model.tap()
        XCTAssertTrue(app.buttons["effort.option.high"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["effort.option.low"].exists, "每个模型只列自己支持的强度")
        captureConversation("原生模型菜单-真实强度档位", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    }

    func testExpandedUserBubbleKeepsCollapsedWidth() {
        let app = launchSidebarPolishFixture()
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        let collapsed = bubble.frame
        app.buttons["展开更多"].tap()
        XCTAssertTrue(app.buttons["收起"].waitForExistence(timeout: 5))
        XCTAssertEqual(bubble.frame.width, collapsed.width, accuracy: 1)
        XCTAssertGreaterThan(bubble.frame.height, collapsed.height)
        captureConversation("用户气泡-展开宽度", app: app)
        app.buttons["收起"].tap()
        XCTAssertTrue(app.buttons["展开更多"].waitForExistence(timeout: 5))
        XCTAssertEqual(bubble.frame.width, collapsed.width, accuracy: 1)
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
        pull(); pull()
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
        let jump = app.buttons["conversation.scrollToBottom"]
        XCTAssertTrue(jump.waitForExistence(timeout: 8), "离开底部时应显示回到底部按钮")
        guard jump.exists else { return }
        XCTAssertTrue(app.buttons["展开更多"].exists)
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

    private func launchConnectedApp() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-scroll-diagnostics", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let gateway = ProcessInfo.processInfo.environment["CODEX_TEST_GATEWAY"]
            ?? ProcessInfo.processInfo.environment["TEST_RUNNER_CODEX_TEST_GATEWAY"]
        let name = "验收 Mac"
        func any(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
        let addressField = any("device.address")
        if !addressField.waitForExistence(timeout: 3) {
            XCTAssertTrue(any("header.usage").waitForExistence(timeout: 12))
            if !any("sidebar.codexMenu").exists { app.buttons["会话列表"].tap() }
            XCTAssertTrue(any("sidebar.codexMenu").waitForExistence(timeout: 8))
            any("sidebar.settings").tap()
            XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 8))
            app.staticTexts["设备"].tap()
            XCTAssertTrue(app.navigationBars["设备"].waitForExistence(timeout: 8))
            if !app.staticTexts[name].exists {
                guard gateway != nil else { throw XCTSkip("需要显式配置本地验收网关") }
                any("devices.add").tap()
            }
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
        if !any("sidebar.codexMenu").exists, app.buttons["会话列表"].exists { app.buttons["会话列表"].tap() }
        XCTAssertTrue(any("sidebar.codexMenu").waitForExistence(timeout: 15))
        any("sidebar.codexMenu").tap()
        let target = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10))
        target.tap()
        XCTAssertTrue(any("sidebar.askCodex").waitForExistence(timeout: 12))
        return app
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
        let cached = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "缓存命中 0%")).firstMatch
        XCTAssertTrue(cached.waitForExistence(timeout: 5), "真实零命中率仍应展示")
    }

    func testAnswerSupportsNativeTextSelection() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-selectable-answer-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let answer = app.textViews["assistant.selectable"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 8))
        XCTAssertTrue((answer.value as? String)?.contains("第二段支持跨段自由选择文字") == true)
        XCTAssertTrue((answer.value as? String)?.contains("Markdown 标题") == true, "相邻段落、标题和列表须能连续选中")
        answer.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.04)).press(forDuration: 1.2)
        XCTAssertTrue(app.menuItems.matching(NSPredicate(format: "label IN %@", ["复制", "Copy"])).firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        captureConversation("回答文字选择与点虚线", app: app)
        app.buttons["header.usage"].tap()
        app.buttons["header.usage"].tap()
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
            let from = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.2))
            let to = timeline.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.85))
            let offset = app.staticTexts["scroll.diagnostic-offset"]
            XCTAssertTrue(offset.waitForExistence(timeout: 5))
            XCTAssertTrue(app.textViews["assistant.selectable"].firstMatch.waitForExistence(timeout: 15))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0.05)
            for _ in 0..<40 {
                if (Int(offset.label) ?? 0) <= 2 { break }
                from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0.05)
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
            let visibleText = NSPredicate { _, _ in
                let viewport = CGRect(x: 0, y: 120, width: app.frame.width, height: app.frame.height - 240)
                return app.textViews.matching(identifier: "assistant.selectable").allElementsBoundByIndex.contains { element in
                    let rect = element.frame.intersection(viewport)
                    return !rect.isNull && rect.width > 20 && rect.height > 10
                }
            }
            expectation(for: visibleText, evaluatedWith: app)
            waitForExpectations(timeout: 8)
            captureConversation("真实关注会话\(index + 1)-回到底部", app: app)
        }
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
        let option = app.buttons["model.option.model-b"]
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
        model.tap()
        XCTAssertTrue(app.buttons["effort.option.medium"].waitForExistence(timeout: 5))
        app.buttons["effort.option.medium"].tap()
        XCTAssertTrue((model.value as? String)?.contains("Medium") == true)
        model.tap()
        app.buttons["model.option.model-b"].tap()
        XCTAssertTrue((model.value as? String)?.hasPrefix("Model B") == true)
        model.tap()
        XCTAssertTrue(app.buttons["effort.option.high"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["effort.option.low"].exists)
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
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-short-question-fixture", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let bubble = app.otherElements["message.user-bubble"].firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        let width = bubble.frame.width
        let time = app.staticTexts["message.user-time"]
        XCTAssertFalse(time.exists)
        bubble.tap()
        XCTAssertTrue(time.waitForExistence(timeout: 3))
        XCTAssertEqual(bubble.frame.width, width, accuracy: 1, "显示外侧时间不能撑宽短气泡")
        XCTAssertEqual(time.frame.maxX, bubble.frame.maxX, accuracy: 1)
        captureConversation("短气泡外侧时间与参考色", app: app)
        bubble.tap()
        XCTAssertFalse(time.exists)
        bubble.press(forDuration: 1.2)
        let copy = app.buttons["复制"]
        XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
        copy.tap()
        XCTAssertTrue(app.staticTexts["已复制"].waitForExistence(timeout: 3))
        XCTAssertFalse(time.exists, "长按复制不应切换发送时间")
        XCTAssertTrue(app.staticTexts["1小时2分钟3秒"].exists)
    }

    func testUsesSystemNavigationAndSettingsForm() {
        let app = launchConversationFixture()
        XCTAssertTrue(app.navigationBars["对话界面回归"].waitForExistence(timeout: 5), "页头应由真实系统导航栏提供")
        captureConversation("系统导航栏-干净状态", app: app)
        app.buttons["会话列表"].tap()
        app.buttons["sidebar.settings"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["settings.form"].exists, "设置应使用系统表单")
        captureConversation("系统设置表单", app: app)
        app.buttons["settings.appearance"].tap()
        XCTAssertTrue(app.buttons["深色"].waitForExistence(timeout: 3))
        app.buttons["深色"].tap()
        app.buttons["settings.appearance"].tap()
        app.buttons["浅色"].tap()
        app.buttons["settings.close"].tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.3)).tap()
        XCTAssertTrue(app.navigationBars["对话界面回归"].waitForExistence(timeout: 5))
        let fixtureError = app.staticTexts["此界面夹具不执行真实业务"]
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: fixtureError)
        waitForExpectations(timeout: 5)
        captureConversation("系统导航栏与消息", app: app)
    }

    func testSystemMenuUsesGatewayEffortValues() {
        let app = launchConversationFixture()
        app.launchArguments.append("--agent-model-efforts-fixture")
        app.launch()
        app.textFields["message-input"].tap()
        let model = app.buttons["composer.model"]
        XCTAssertTrue(model.waitForExistence(timeout: 5))
        model.tap()
        app.buttons["effort.option.high"].tap()
        XCTAssertTrue((model.value as? String)?.contains("High") == true)
        model.tap()
        app.buttons["model.option.model-b"].tap()
        XCTAssertTrue((model.value as? String)?.hasPrefix("Model B") == true)
        model.tap()
        XCTAssertTrue(app.buttons["effort.option.high"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["effort.option.medium"].exists)
        captureConversation("原生菜单与真实模型强度", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    }

    func testConfigureProvidedGateway() throws {
        let app = try launchConnectedApp()
        XCTAssertTrue(app.staticTexts["验收 Mac"].exists)
    }

    func testLiveMessageRoundTripAndArchive() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.askCodex"].tap()
        let input = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        input.tap()
        let marker = "AGENTUI-" + String(UUID().uuidString.prefix(8))
        input.typeText("这是原生客户端验收测试。请先发送一条简短执行进展，再调用工具查询当前工作目录，最后只回复：" + marker + "。只读验证，不要修改文件。")
        let send = app.buttons["composer.submit"]
        XCTAssertTrue(send.isEnabled)
        send.tap()
        let response = app.textViews.matching(NSPredicate(format: "value BEGINSWITH %@", marker)).firstMatch
        XCTAssertTrue(response.waitForExistence(timeout: 150), "应收到真实网关的模型回复")
        let history = app.buttons["commentary-history-toggle"].firstMatch
        XCTAssertTrue(history.waitForExistence(timeout: 8), "真实执行进展应进入参考历史组件")
        history.tap()
        captureConversation("真实网关-执行过程", app: app)
        app.buttons["header.usage"].tap()
        XCTAssertTrue(app.staticTexts["上下文余量"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["额度剩余"].exists)
        XCTAssertTrue(app.staticTexts["输入 Token"].exists)
        app.buttons["header.usage"].tap()
        app.buttons["conversation.actions"].tap()
        app.buttons["归档"].tap()
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
        app.buttons["sidebar.settings"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["设备"].exists || app.staticTexts["设备"].exists)
        XCTAssertTrue(app.buttons["通知"].exists || app.staticTexts["通知"].exists)
    }

    func testKeepNativeInterfaceEnabledForAcceptance() throws {
        let app = try launchConnectedApp()
        app.buttons["sidebar.settings"].tap()
        let toggle = app.switches["native-ui-preference"]
        for _ in 0..<3 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 8))
        if toggle.value as? String == "0" { toggle.tap() }
        let enabled = NSPredicate(format: "value == '1'")
        expectation(for: enabled, evaluatedWith: toggle)
        waitForExpectations(timeout: 12)
        app.buttons["settings.close"].tap()
    }
}
