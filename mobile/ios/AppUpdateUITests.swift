import XCTest

final class AppUpdateUITests: XCTestCase {
    func testVersionInfoDoesNotOfferManualUpdateCheck() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "vip.loock.codexmobile")
        app.launch()
        let cancel = app.webViews.buttons["取消"]
        if cancel.waitForExistence(timeout: 5) { cancel.tap() }
        let version = app.webViews.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "当前版本 v")
        ).firstMatch
        if !version.exists {
            let manage = app.webViews.buttons["管理设备"]
            XCTAssertTrue(manage.waitForExistence(timeout: 20), app.debugDescription)
            manage.tap()
        }
        for _ in 0..<5 {
            if version.exists && version.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(version.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(version.isHittable)
        XCTAssertFalse(app.webViews.buttons["检查更新"].exists, app.debugDescription)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "iOS 版本信息与移除手动检查更新入口"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
