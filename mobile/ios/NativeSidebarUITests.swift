import XCTest

final class NativeSidebarUITests: XCTestCase {
    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = app.screenshot()
        if ProcessInfo.processInfo.environment["NATIVE_IOS_EXPORT_SCREENSHOTS"] == "1" {
            let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("NativeSidebarCaptures")
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try screenshot.pngRepresentation.write(to: folder.appendingPathComponent(name + ".png"))
            } catch { XCTFail("无法保存边栏原始截图：\(error)") }
        }
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func sidebar(_ app: XCUIApplication) -> XCUIElement {
        app.launch()
        let newChat = app.buttons["codex.native.sidebar.new"]
        if !newChat.waitForExistence(timeout: 3), app.webViews.buttons["管理设备"].waitForExistence(timeout: 10) {
            chooseInterface(app, "原生界面")
        }
        if !newChat.waitForExistence(timeout: 3) {
            let add = app.webViews.buttons["添加设备"]
            if add.exists { add.tap() }
            let address = app.webViews.textFields["网关地址"]
            XCTAssertTrue(address.waitForExistence(timeout: 15), app.debugDescription)
            let name = app.webViews.textFields["设备名称"]
            name.tap(); name.typeText("Visual Simulator")
            address.tap(); address.typeText("http://127.0.0.1:18786/?token=ios-simulator-check")
            app.webViews.buttons["测试并保存"].tap()
        }
        XCTAssertTrue(newChat.waitForExistence(timeout: 30), app.debugDescription)
        let table = app.tables["codex.native.sidebar.list"]
        XCTAssertTrue(table.exists); XCTAssertTrue(newChat.isHittable)
        XCTAssertGreaterThanOrEqual(newChat.frame.height, 44)
        XCTAssertFalse(app.webViews.textFields["codex.native.sidebar.search"].exists)
        return table
    }
    func test00ConfigureSimulatorGateway() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let newChat = app.buttons["codex.native.sidebar.new"]
        if newChat.waitForExistence(timeout: 5) {
            if app.tables["codex.native.sidebar.list"].cells.firstMatch.waitForExistence(timeout: 3) { return }
            app.buttons["codex.native.sidebar.devices"].tap()
            XCTAssertTrue(app.webViews.buttons["关闭"].waitForExistence(timeout: 10))
            XCTAssertFalse(newChat.exists, "网页设备管理必须暂停原生覆盖层")
            let edit = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "编辑 ")).firstMatch
            for _ in 0..<6 { if edit.isHittable { break }; app.webViews.firstMatch.swipeUp() }
            XCTAssertTrue(edit.isHittable, app.debugDescription); edit.tap()
        }
        let address = app.webViews.textFields["网关地址"]
        XCTAssertTrue(address.waitForExistence(timeout: 10), app.debugDescription)
        let name = app.webViews.textFields["设备名称"]
        name.tap()
        if let current = name.value as? String, !current.isEmpty { name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count)) }
        name.typeText("Visual Simulator")
        address.tap()
        if let current = address.value as? String, !current.isEmpty { address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count)) }
        address.typeText("http://127.0.0.1:18786/?token=ios-simulator-check")
        app.webViews.buttons["测试并保存"].tap()
        XCTAssertTrue(address.waitForNonExistence(timeout: 30), app.debugDescription)
        if app.webViews.buttons["关闭"].exists { app.webViews.buttons["关闭"].tap() }
        XCTAssertTrue(newChat.waitForExistence(timeout: 10))
        XCTAssertTrue(app.tables["codex.native.sidebar.list"].cells.firstMatch.waitForExistence(timeout: 30))
    }
    func testSearchAndCloseClearQueryAndKeepConversationDraft() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        _ = sidebar(app)
        capture(app, "sidebar-light")
        app.buttons["codex.native.sidebar.new"].tap()
        let composer = app.textViews["codex.native.composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap(); composer.typeText("原生边栏未发送草稿")
        app.toolbars.buttons["codex.native.keyboard.done"].tap()
        app.buttons["codex.native.back"].tap()
        let search = app.searchFields["codex.native.sidebar.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10), app.debugDescription)
        search.tap(); search.typeText("ZXQ不存在的会话ZXQ")
        XCTAssertTrue(app.staticTexts["没有匹配的对话"].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(search.value as? String, "ZXQ不存在的会话ZXQ")
        capture(app, "sidebar-search-keyboard")
        app.buttons["codex.native.sidebar.close"].tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, "原生边栏未发送草稿")
        app.buttons["codex.native.back"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        XCTAssertFalse((search.value as? String ?? "").contains("ZXQ"))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture(app, "sidebar-search-reset")
    }
    func testDeviceMenuProjectsAndLongPressAreNative() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let table = sidebar(app)
        XCTAssertTrue(table.cells.firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        table.cells.firstMatch.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["复制会话 ID"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["置顶"].exists || app.buttons["取消置顶"].exists)
        capture(app, "sidebar-context-menu")
        // 只读复制，不更改真实会话。
        app.buttons["复制会话 ID"].tap()
        table.cells.firstMatch.press(forDuration: 1.2)
        app.buttons["重命名"].tap()
        let rename = app.alerts["重命名"]
        XCTAssertTrue(rename.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(rename.textFields.firstMatch.exists)
        capture(app, "sidebar-native-rename")
        rename.buttons["取消"].tap()
        app.buttons["codex.native.sidebar.backend"].tap()
        let device = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Visual Simulator", "iOS Simulator")).firstMatch
        XCTAssertTrue(device.waitForExistence(timeout: 5), app.debugDescription)
        device.tap()
        let project = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "codex.native.sidebar.project.project:")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertGreaterThanOrEqual(project.frame.height, 44)
        project.tap(); capture(app, "sidebar-projects")
        // 再次展开，恢复测试前的折叠状态。
        project.tap()
        app.buttons["codex.native.sidebar.backend"].tap()
        app.buttons["全部设备"].tap()
    }
    func testSidebarAccessibilityTextRemainsUsable() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        let table = sidebar(app)
        XCTAssertTrue(table.cells.firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["codex.native.sidebar.close"].isHittable)
        XCTAssertTrue(app.buttons["codex.native.sidebar.new"].isHittable)
        let search = app.searchFields["codex.native.sidebar.search"]
        XCTAssertTrue(search.isHittable)
        XCTAssertGreaterThanOrEqual(table.cells.firstMatch.frame.height, 80)
        XCTAssertGreaterThanOrEqual(table.frame.height, 180, "最大辅助字号仍需留下可滚动、可操作的列表空间")
        XCTAssertTrue(table.cells.firstMatch.isHittable)
        capture(app, "sidebar-accessibility")
        search.tap(); search.typeText("ZXQ辅助字号搜索ZXQ")
        XCTAssertTrue(app.buttons["codex.native.sidebar.close"].isHittable)
        XCTAssertTrue(search.isHittable)
        capture(app, "sidebar-accessibility-keyboard")
        app.buttons["codex.native.sidebar.close"].tap()
        XCTAssertTrue(table.waitForNonExistence(timeout: 10))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }
    func testSearchFailureRemainsVisibleWithKeyboard() throws {
        guard ProcessInfo.processInfo.environment["NATIVE_SIDEBAR_OFFLINE_TEST"] == "1" else { throw XCTSkip("专门在本次网关停止时运行") }
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        _ = sidebar(app)
        let search = app.searchFields["codex.native.sidebar.search"]
        search.tap(); search.typeText("ZXQ失败搜索ZXQ")
        let error = app.staticTexts["codex.native.sidebar.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(app.buttons["codex.native.sidebar.retry"].exists)
        XCTAssertFalse(app.staticTexts["没有匹配的对话"].exists)
        XCTAssertEqual(search.value as? String, "ZXQ失败搜索ZXQ")
        capture(app, "sidebar-error-keyboard")
    }
    func testCaptureSidebarDesign() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        let table = sidebar(app)
        XCTAssertTrue(table.cells.firstMatch.waitForExistence(timeout: 30))
        capture(app, "sidebar-design")
        table.swipeUp()
        capture(app, "sidebar-scrolled")
        table.swipeLeft()
        XCTAssertTrue(table.waitForNonExistence(timeout: 10), app.debugDescription)
    }
    private func chooseInterface(_ app: XCUIApplication, _ label: String) {
        let nativeDevices = app.buttons["codex.native.sidebar.devices"]
        if nativeDevices.exists { nativeDevices.tap() }
        else { app.webViews.buttons["管理设备"].tap() }
        let close = app.webViews.buttons["关闭"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), app.debugDescription)
        let mode = app.webViews.switches[label]
        for _ in 0..<12 {
            if mode.isHittable { break }
            app.webViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(mode.isHittable, app.debugDescription)
        mode.tap(); close.tap()
    }
    func testWebComparisonRetainsDraftAndRestoresNative() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        _ = sidebar(app)
        app.buttons["codex.native.sidebar.new"].tap()
        let composer = app.textViews["codex.native.composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap(); composer.typeText("两种界面共用的未发送草稿")
        app.toolbars.buttons["codex.native.keyboard.done"].tap()
        capture(app, "comparison-native-draft")
        app.buttons["codex.native.back"].tap()
        chooseInterface(app, "网页界面")
        XCTAssertFalse(app.tables["codex.native.sidebar.list"].exists)
        XCTAssertTrue(app.webViews.textFields["搜索聊天"].waitForExistence(timeout: 10), app.debugDescription)
        capture(app, "comparison-web-sidebar")
        app.webViews.buttons["关闭会话列表"].firstMatch.tap()
        let webComposer = app.webViews.textViews["向 Codex 提问"]
        XCTAssertTrue(webComposer.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(webComposer.value as? String, "两种界面共用的未发送草稿")
        webComposer.tap(); webComposer.typeText("\n网页继续编辑")
        capture(app, "comparison-web-keyboard")
        let done = app.toolbars.buttons["完成"]
        if done.exists { done.tap() }
        app.webViews.buttons["打开会话列表"].tap()
        chooseInterface(app, "原生界面")
        XCTAssertTrue(app.tables["codex.native.sidebar.list"].waitForExistence(timeout: 10))
        app.buttons["codex.native.sidebar.close"].tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, "两种界面共用的未发送草稿\n网页继续编辑")
        capture(app, "comparison-native-restored")
    }
    func testWebAccessibilityTextAndSidebarRemainUsable() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        _ = sidebar(app)
        capture(app, "comparison-native-accessibility")
        chooseInterface(app, "网页界面")
        let search = app.webViews.textFields["搜索聊天"]
        XCTAssertTrue(search.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThanOrEqual(search.frame.height, 60, "网页搜索必须跟随最大系统辅助字号")
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(app.webViews.buttons["聊天"].isHittable)
        capture(app, "comparison-web-accessibility")
        chooseInterface(app, "原生界面")
        XCTAssertTrue(app.buttons["codex.native.sidebar.new"].waitForExistence(timeout: 10))
    }

}
