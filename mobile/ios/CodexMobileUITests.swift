import XCTest

final class CodexMobileUITests: XCTestCase {
    private func openNewChat(_ app: XCUIApplication) -> XCUIElement {
        let chat = app.webViews.buttons["聊天"]
        XCTAssertTrue(chat.waitForExistence(timeout: 20))
        chat.tap()
        let input = app.webViews.textViews["向 Codex 提问"]
        if !input.waitForExistence(timeout: 3) {
            // 启动恢复可能先重置页面；待初始化完成后重新打开测试的新对话。
            XCTAssertTrue(chat.waitForExistence(timeout: 10))
            chat.tap()
        }
        XCTAssertTrue(input.waitForExistence(timeout: 10), app.debugDescription)
        return input
    }

    func testBottomBarsClearHomeIndicatorWithoutKeyboard() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let input = openNewChat(app)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertGreaterThanOrEqual(app.frame.maxY - input.frame.maxY, 42,
                                    "键盘收起时输入框应位于 Home 指示条安全区上方")
        input.tap()
        input.typeText("底部安全区未发送草稿")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews.buttons["发送"].isHittable)
        let done = app.toolbars.buttons["Done"]
        if done.exists { done.tap() } else { app.toolbars.buttons["完成"].tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "底部安全区未发送草稿")
        XCTAssertGreaterThanOrEqual(app.frame.maxY - input.frame.maxY, 42)
        app.webViews.buttons["打开会话列表"].tap()
        let chat = app.webViews.buttons["聊天"]
        XCTAssertTrue(chat.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(app.frame.maxY - chat.frame.maxY, 42,
                                    "下边栏应位于 Home 指示条安全区上方")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "下边栏底部安全区"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testUnsentDraftRemainsStableAfterKeyboardDismissal() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let drafts = [
            "Unsent keyboard regression draft",
            "第一行未发送的中文草稿\n第二行继续输入，点击对号收起键盘\n第三行保持内容",
            String(repeating: "保留较长的输入文字，收起键盘时不能跳动。", count: 8),
        ]
        for draft in drafts {
            app.terminate()
            app.launch()
            let input = openNewChat(app)
            input.tap()
            input.typeText(draft)
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            let done = app.toolbars.buttons["Done"]
            let doneChinese = app.toolbars.buttons["完成"]
            if done.exists { done.tap() }
            else if doneChinese.exists { doneChinese.tap() }
            else { XCTFail("键盘对号收起按钮不存在：\(app.debugDescription)"); return }
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
            let probe = app.staticTexts["codex.keyboard-dismissal-height-difference"]
            XCTAssertTrue(probe.waitForExistence(timeout: 3), "测试工程应安装键盘布局探针")
            XCTAssertGreaterThan(try XCTUnwrap(Int(probe.value as? String ?? "")), 0, "探针应采到实际帧")
            let heightDifference = try XCTUnwrap(Double(probe.label))
            print("KEYBOARD_DISMISSAL_GAP draftLength=\(draft.count) maximum=\(heightDifference)")
            XCTAssertEqual(app.staticTexts["codex.geometry-animation-count"].label, "0")
            let scrollAnimations = app.staticTexts["codex.scroll-geometry-animation-count"]
            print("SCROLL_GEOMETRY_ANIMATIONS maximum=\(scrollAnimations.label)")
            XCTAssertEqual(scrollAnimations.label, "0", "键盘收起时原生滚动容器不应与网页布局使用不同的动画尺寸")
            let frame = input.frame
            for _ in 0..<12 {
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
                XCTAssertEqual(input.frame.minY, frame.minY, accuracy: 1, "收起键盘后输入框应停止跳动")
                XCTAssertEqual(input.value as? String, draft)
            }
            XCTAssertGreaterThan(frame.minY, app.frame.height * 0.7, "输入框应回到屏幕底部")
            XCTAssertTrue(app.webViews.buttons["发送"].isHittable)
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "对号收起-\(draft.count)字草稿"
            attachment.lifetime = .keepAlways
            add(attachment)
            input.tap()
            input.typeText(" retained")
            let resumedDraft = input.value as? String ?? ""
            XCTAssertTrue(resumedDraft.contains(" retained"))
            XCTAssertEqual(resumedDraft.replacingOccurrences(of: " retained", with: ""), draft)
            XCTAssertTrue(app.webViews.buttons["发送"].isHittable)
        }
    }

    func testRepeatedKeyboardDismissalPreservesUrlDraft() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let input = openNewChat(app)
        let draft = "nsk-sign://addsource?url=%E6%BA%90%E5%9C%B0%E5%9D%80"
        for cycle in 0..<3 {
            input.tap()
            if cycle == 0 { input.typeText(draft) }
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            XCTAssertEqual(input.value as? String, draft)
            let before = XCTAttachment(screenshot: app.screenshot())
            before.name = "URL草稿收起前-\(cycle)"
            before.lifetime = .keepAlways
            add(before)
            let done = app.toolbars.buttons["Done"]
            if done.exists { done.tap() } else { app.toolbars.buttons["完成"].tap() }
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
            let probe = app.staticTexts["codex.keyboard-dismissal-height-difference"]
            XCTAssertTrue(probe.waitForExistence(timeout: 3))
            print("URL_DISMISSAL cycle=\(cycle) gap=\(probe.label)")
            XCTAssertGreaterThan(try XCTUnwrap(Int(probe.value as? String ?? "")), 0)
            XCTAssertEqual(app.staticTexts["codex.geometry-animation-count"].label, "0")
            let scrollAnimations = app.staticTexts["codex.scroll-geometry-animation-count"]
            print("SCROLL_GEOMETRY_ANIMATIONS maximum=\(scrollAnimations.label)")
            XCTAssertEqual(scrollAnimations.label, "0", "键盘收起时原生滚动容器不应与网页布局使用不同的动画尺寸")
            let frame = input.frame
            for _ in 0..<12 {
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
                XCTAssertEqual(input.frame.minY, frame.minY, accuracy: 1)
                XCTAssertEqual(input.value as? String, draft)
            }
            let after = XCTAttachment(screenshot: app.screenshot())
            after.name = "URL草稿收起后-\(cycle)"
            after.lifetime = .keepAlways
            add(after)
        }
    }

    func testSendingDismissesKeyboardWithoutFlicker() throws {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "发送通知授权") { alert in
            for title in ["不允许", "Don’t Allow"] {
                if alert.buttons[title].exists { alert.buttons[title].tap(); return true }
            }
            return false
        }
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        for (index, maximized) in [false, false, true].enumerated() {
            app.terminate()
            app.launch()
            let input = openNewChat(app)
            if maximized {
                let collapsedInputHeight = input.frame.height
                let maximize = app.descendants(matching: .any).matching(identifier: "最大化输入框").firstMatch
                if maximize.exists { maximize.tap() }
                else {
                    // WebKit 有时不将纯 SVG 按钮暴露成 AXButton；按相邻输入框定位同一按钮。
                    input.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
                        .withOffset(CGVector(dx: 17, dy: 0)).tap()
                }
                // 键盘已经出现时可用高度会缩小，比较展开前后实际输入区域。
                XCTAssertGreaterThan(input.frame.height, collapsedInputHeight * 2, "最大化输入框应展开")
            }
            input.tap()
            let marker = "IOS_SEND_STABLE_\(index)"
            let prefix = index == 0 ? "" : String(repeating: "这是保留较长中文输入的发送布局验证。\n", count: 8)
            input.typeText(prefix + "请只回复 " + marker + "，不调用工具，不修改文件。")
            XCTAssertTrue(app.keyboards.firstMatch.exists)
            XCTAssertTrue(app.webViews.buttons["发送"].isHittable)
            app.webViews.buttons["发送"].tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "发送后应收起键盘")
            let probe = app.staticTexts["codex.keyboard-dismissal-height-difference"]
            XCTAssertTrue(probe.waitForExistence(timeout: 3))
            XCTAssertGreaterThan(try XCTUnwrap(Int(probe.value as? String ?? "")), 0, "探针应采到实际帧")
            let difference = try XCTUnwrap(Double(probe.label))
            print("SEND_KEYBOARD_GAP case=\(index) maximum=\(difference) samples=\(probe.value ?? "")")
            let sendFocus = app.staticTexts["codex.send-retained-input-focus"]
            XCTAssertTrue(sendFocus.waitForExistence(timeout: 3))
            print("SEND_RETAINED_INPUT_FOCUS case=\(index) value=\(sendFocus.label)")
            XCTAssertEqual(sendFocus.label, "false", "发送事件结束时必须已经取消输入焦点")
            let geometry = app.staticTexts["codex.geometry-animation-count"]
            XCTAssertTrue(geometry.waitForExistence(timeout: 3))
            print("SEND_GEOMETRY_ANIMATIONS case=\(index) maximum=\(geometry.label)")
            XCTAssertEqual(geometry.label, "0", "发送收起过程中不应追加主图层几何动画")
            // WKWebView 的辅助功能会用 placeholder 代表空 textarea。
            XCTAssertTrue(["", "向 Codex 提问"].contains(input.value as? String ?? ""))
            let scrollAnimations = app.staticTexts["codex.scroll-geometry-animation-count"]
            print("SCROLL_GEOMETRY_ANIMATIONS maximum=\(scrollAnimations.label)")
            XCTAssertEqual(scrollAnimations.label, "0", "键盘收起时原生滚动容器不应与网页布局使用不同的动画尺寸")
            let frame = input.frame
            for _ in 0..<12 {
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
                XCTAssertEqual(input.frame.minY, frame.minY, accuracy: 1)
            }
            XCTAssertGreaterThan(frame.minY, app.frame.height * 0.7)
            XCTAssertTrue(app.webViews.staticTexts[marker].waitForExistence(timeout: 90), app.debugDescription)
            input.tap()
            input.typeText("下一条未发送草稿")
            XCTAssertEqual(input.value as? String, "下一条未发送草稿")
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "发送后稳定-\(index)"
            image.lifetime = .keepAlways
            add(image)
        }
    }

    func testEmbeddedFrontendAndGatewayConnection() throws {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "系统通知授权") { alert in
            let deny = alert.buttons["不允许"]
            if deny.exists { deny.tap(); return true }
            let denyEnglish = alert.buttons["Don’t Allow"]
            if denyEnglish.exists { denyEnglish.tap(); return true }
            return false
        }
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        if !app.webViews.buttons["管理设备"].waitForExistence(timeout: 3) {
            let address = app.webViews.textFields["网关地址"]
            XCTAssertTrue(address.waitForExistence(timeout: 20), app.debugDescription)
            let name = app.webViews.textFields["设备名称"]
            name.tap()
            name.typeText("iOS Simulator")
            let keyboardImage = XCTAttachment(screenshot: app.screenshot())
            keyboardImage.lifetime = .keepAlways
            add(keyboardImage)
            address.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
            address.typeText("http://127.0.0.1:18786/?token=wrong")
            app.webViews.buttons["测试并保存"].tap()
            XCTAssertTrue(app.webViews.staticTexts["访问口令不正确"].waitForExistence(timeout: 15), app.debugDescription)
            app.webViews.buttons["取消"].tap()
            app.webViews.buttons["添加设备"].tap()
            name.tap()
            name.typeText("iOS Simulator")
            address.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
            address.typeText("http://127.0.0.1:18786/?token=ios-simulator-check")
            app.webViews.buttons["测试并保存"].tap()
            XCTAssertTrue(app.webViews.buttons["管理设备"].waitForExistence(timeout: 30), app.debugDescription)
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "iOS 网关连接成功"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.webViews.buttons["管理设备"].waitForExistence(timeout: 20), app.debugDescription)
        app.webViews.buttons["聊天"].tap()
        let input = app.webViews.textViews["向 Codex 提问"]
        XCTAssertTrue(input.waitForExistence(timeout: 15), app.debugDescription)
        let settings = app.webViews.buttons["选择模型、智能与速度"]
        settings.tap()
        let medium = app.webViews.switches.containing(NSPredicate(format: "label BEGINSWITH %@", "中")).firstMatch
        XCTAssertTrue(medium.waitForExistence(timeout: 10), app.debugDescription)
        medium.tap()
        XCTAssertTrue(settings.label.contains("选择模型"))
        input.tap()
        input.typeText("这是 iOS 模拟器自动化验证。请只回复 IOS_SIMULATOR_OK，不调用工具，不修改文件。")
        XCTAssertTrue(app.webViews.buttons["发送"].isHittable, "键盘弹出时发送按钮应可操作")
        app.webViews.buttons["发送"].tap()
        XCTAssertTrue(app.webViews.staticTexts["IOS_SIMULATOR_OK"].waitForExistence(timeout: 90), app.debugDescription)
        if app.alerts.buttons["不允许"].exists { app.alerts.buttons["不允许"].tap() }
        let resultImage = XCTAttachment(screenshot: app.screenshot())
        resultImage.name = "iOS 消息往返成功"
        resultImage.lifetime = .keepAlways
        add(resultImage)
    }
}
