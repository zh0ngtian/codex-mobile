import XCTest

final class AppUpdateUITests: XCTestCase {
    func testCheckForUpdatesUsesIosBridge() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let cancel = app.webViews.buttons["取消"]
        if cancel.waitForExistence(timeout: 5) { cancel.tap() }
        let check = app.webViews.buttons["检查更新"]
        if !check.waitForExistence(timeout: 2) {
            let manage = app.webViews.buttons["管理设备"]
            XCTAssertTrue(manage.waitForExistence(timeout: 20), app.debugDescription)
            manage.tap()
        }
        for _ in 0..<5 {
            if check.exists && check.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(check.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(check.isHittable)
        check.tap()
        XCTAssertTrue(app.webViews.staticTexts["iOS 更新源未配置或签名身份不兼容"].waitForExistence(timeout: 5))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "iOS 检查更新与未配置状态"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
