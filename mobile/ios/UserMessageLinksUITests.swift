import XCTest
import SwiftUI
import UIKit

@MainActor final class UserMessageLinksUITests: XCTestCase {
    private let href = "https://example.com/blogs/?post=usersettings"

    func testLinkDestinationAndWrappedHitTestingPreserveTimestampAction() {
        let source = "前文 [教程](\(href)) 后文\n[换行的长链接标签用于覆盖跨行命中区域](\(href))"
        let text = NativeSelectableMarkdown.inline(source)
        XCTAssertEqual(text.string, "前文 教程 后文\n换行的长链接标签用于覆盖跨行命中区域")
        let storage = NSTextStorage()
        let manager = NativeDottedTextLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 150, height: CGFloat.greatestFiniteMagnitude))
        storage.addLayoutManager(manager); manager.addTextContainer(container)
        let view = UITextView(frame: CGRect(x: 0, y: 0, width: 150, height: 300), textContainer: container)
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.attributedText = text
        view.isEditable = false
        view.isSelectable = false
        view.layoutManager.ensureLayout(for: view.textContainer)
        var opened: [URL] = []
        var expectedTaps = 0
        var timestampTaps = 0
        let coordinator = NativeSelectableText.Coordinator(openLink: { opened.append($0) })
        coordinator.onTap = { timestampTaps += 1 }
        let range = NSRange(location: 0, length: text.length)
        text.enumerateAttribute(.link, in: range) { value, range, _ in
            guard let url = value as? URL else { return }
            XCTAssertEqual(url.absoluteString, href)
            let glyphs = view.layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            expectedTaps += glyphs.length
            if range.length > 10 {
                let first = view.layoutManager.lineFragmentRect(forGlyphAt: glyphs.location, effectiveRange: nil)
                let last = view.layoutManager.lineFragmentRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil)
                XCTAssertGreaterThan(last.minY, first.minY, "长链接实际跨行排版")
            }
            for glyph in glyphs.location..<NSMaxRange(glyphs) {
                let bounds = view.layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: view.textContainer)
                let before = opened.count
                coordinator.handleTap(at: CGPoint(x: bounds.midX, y: bounds.midY), in: view)
                XCTAssertEqual(opened.count, before + 1, "默认未选择时每次命中只打开一次")
            }
        }
        XCTAssertEqual(opened.count, expectedTaps)
        XCTAssertEqual(timestampTaps, 0, "链接点击不能切换时间")
        coordinator.handleTap(at: CGPoint(x: 145, y: 290), in: view)
        XCTAssertEqual(timestampTaps, 1, "空白不能误命中最近的链接")

        let label = (text.string as NSString).range(of: "教程")
        let bounds = view.layoutManager.boundingRect(forGlyphRange: view.layoutManager.glyphRange(forCharacterRange: label, actualCharacterRange: nil), in: view.textContainer)
        let before = opened.count
        view.isSelectable = true
        coordinator.handleTap(at: CGPoint(x: bounds.midX, y: bounds.midY), in: view)
        XCTAssertEqual(opened.count, before, "系统选择模式交给原生链接处理，避免重复打开")
        XCTAssertEqual(timestampTaps, 1)
        view.selectedRange = label
        coordinator.handleTap(at: CGPoint(x: 145, y: 290), in: view)
        XCTAssertEqual(timestampTaps, 1, "拖动选区时不能切换时间")
    }

    func testUserBubbleRendersLinkAndKeepsOriginalWhenEditing() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-edit-history-fixture", "--agent-user-links-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let body = app.textViews["user.selectable"].firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        XCTAssertEqual(body.value as? String, "看下这个教程 \(href)")
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "用户消息-Markdown链接显示"; image.lifetime = .keepAlways; add(image)
        let time = app.staticTexts["message.user-time"]
        XCTAssertFalse(time.exists)
        // 第一行的URL起点：点在链接文字中，默认不进入文字选择模式。
        body.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 145, dy: 10)).tap()
        let backgrounded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state != .runningForeground }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [backgrounded], timeout: 8), .completed, "链接须交给系统浏览器打开")
        app.activate()
        XCTAssertFalse(time.exists, "打开链接不显示时间")
        body.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 10, dy: 10)).tap()
        XCTAssertTrue(time.waitForExistence(timeout: 3), "普通正文仍切换时间")
        body.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 10, dy: 10)).press(forDuration: 1)
        XCTAssertTrue(app.buttons["复制"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["选择文本"].exists)
        app.buttons["复制"].tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap(); input.press(forDuration: 1.2)
        let paste = app.menuItems.matching(NSPredicate(format: "label IN %@", ["粘贴", "Paste"])).firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
        paste.tap()
        XCTAssertEqual(input.value as? String, "看下这个教程 [\(href)](\(href))\n", "复制保留完整原文")
        body.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 10, dy: 10)).press(forDuration: 1)
        XCTAssertTrue(app.buttons["编辑"].waitForExistence(timeout: 5))
        app.buttons["编辑"].tap()
        let editor = app.descendants(matching: .any).matching(identifier: "history.editor").firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(editor.value as? String, "看下这个教程 [\(href)](\(href))\n", "编辑保留原始Markdown与末尾换行")
    }
}
