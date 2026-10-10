import XCTest

final class HorizontalScrollUITests: XCTestCase {
    @MainActor func testHistoricalEditorKeepsPageFixedAndVerticalScrollWorks() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-history-horizontal-scroll-test"]
        app.launch()
        let probe = app.staticTexts["codex.horizontal-scroll-state"]
        XCTAssertTrue(probe.waitForExistence(timeout: 15))
        func state() throws -> [String: Double] {
            let data = try XCTUnwrap(probe.label.data(using: .utf8))
            return try JSONDecoder().decode([String: Double].self, from: data)
        }
        let ready = NSPredicate { _, _ in (try? state()["overflow"]) != nil }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: probe)], timeout: 15), .completed)
        let left = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 45, dy: 360))
        let right = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 250, dy: 360))
        left.press(forDuration: 0.1, thenDragTo: right, withVelocity: .slow, thenHoldForDuration: 0.3)
        right.press(forDuration: 0.1, thenDragTo: left, withVelocity: .slow, thenHoldForDuration: 0.3)
        let afterHorizontal = try state()
        let evidence = XCTAttachment(string: "横向拖动采样：\(afterHorizontal)")
        evidence.lifetime = .keepAlways
        add(evidence)
        XCTAssertEqual(try XCTUnwrap(afterHorizontal["overflow"]), 0, accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(afterHorizontal["x"]), 0, accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(afterHorizontal["nativeX"]), 0, accuracy: 0.5)
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 140, dy: 650))
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 140, dy: 320))
        bottom.press(forDuration: 0.1, thenDragTo: top)
        let vertical = NSPredicate { _, _ in ((try? state()["y"]) ?? 0) > 100 }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: vertical, object: probe)], timeout: 5), .completed)
    }
}
