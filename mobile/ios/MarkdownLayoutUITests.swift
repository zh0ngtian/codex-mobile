import XCTest
import UIKit

@MainActor final class MarkdownLayoutUITests: XCTestCase {
    private let digest = "bd309dfa76a14e11957cd035f976372b22fd7e1e4dea46569008a55cff820a07"

    private func layout(_ source: String, width: CGFloat = 350) -> (NSAttributedString, NSLayoutManager, NSTextContainer) {
        let text = NativeSystemTypography.resolved(NativeSelectableMarkdown.blocks(NativeMarkdownBlock.parse(source)), size: .large, bold: false)
        let storage = NSTextStorage(attributedString: text)
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: width, height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        storage.addLayoutManager(manager); manager.addTextContainer(container); manager.ensureLayout(for: container)
        return (storage, manager, container)
    }

    private func origin(_ needle: String, text: NSAttributedString, manager: NSLayoutManager) -> CGPoint {
        let range = (text.string as NSString).range(of: needle)
        XCTAssertNotEqual(range.location, NSNotFound)
        guard range.location != NSNotFound else { return .zero }
        let glyph = manager.glyphIndexForCharacter(at: range.location)
        let line = manager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let point = manager.location(forGlyphAt: glyph)
        return CGPoint(x: line.minX + point.x, y: line.minY + point.y)
    }

    func testDownloadListContinuationAlignsLabelAndWrappedHash() {
        let source = "- [APK 下载](https://example.com/app.apk)：4,745,915 字节  \n  SHA-256：`\(digest)`\n- [IPA 下载](https://example.com/app.ipa)：4,834,512 字节  \n  SHA-256：`884c6ba4f26dee837bb676dc707a60591d0f134932abcd030910c170e1e39c28`\n\n渠道回验通过。"
        let blocks = NativeMarkdownBlock.parse(source)
        XCTAssertEqual(blocks.map(\.kind), [.list, .list, .text], "SHA续行应属于同一个列表项")
        let (text, manager, _) = layout(source)
        let item = origin("APK 下载", text: text, manager: manager)
        let label = origin("SHA-256", text: text, manager: manager)
        XCTAssertEqual(label.x, item.x, accuracy: 0.5, "SHA标签须与列表正文对齐")
        let range = (text.string as NSString).range(of: digest)
        var lines = 0
        manager.enumerateLineFragments(forGlyphRange: manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)) { _, used, _, _, _ in
            lines += 1
            XCTAssertGreaterThanOrEqual(used.minX, item.x - 0.5, "等宽序列的折行不得退回页面左边缘")
            XCTAssertLessThanOrEqual(used.maxX, 350.5)
        }
        XCTAssertGreaterThan(lines, 1, "长等宽序列须在正文宽度内换行")
        XCTAssertTrue(text.string.contains(digest), "视觉折行不得改写SHA内容")
    }

    func testOrderedTaskAndLooseListContinuationsKeepTheirOwnIndent() {
        for source in ["10. 下载文件\n    校验内容", "- [x] 下载文件\n  校验内容", "  - 下载文件\n    校验内容", "- 下载文件\n\n  校验内容"] {
            let blocks = NativeMarkdownBlock.parse(source)
            XCTAssertEqual(blocks.count, 1)
            let (text, manager, _) = layout(source)
            XCTAssertEqual(origin("下载文件", text: text, manager: manager).x,
                           origin("校验内容", text: text, manager: manager).x, accuracy: 0.5)
        }
        let boundaries = NativeMarkdownBlock.parse("- 父项\n  续行\n  - 子项\n    子项续行\n\n普通正文\n\n```text\ncode\n```")
        XCTAssertEqual(boundaries.map(\.kind), [.list, .list, .text, .code], "不能吞掉子项、普通段落或代码块")
    }

    func testMonospacedCodeWrapsInsideCardWithoutChangingText() {
        let token = String(repeating: "0123456789abcdef", count: 16)
        let code = token + "\nreturn " + String(repeating: "TOKEN_", count: 32)
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-monospace-wrap-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let view = app.textViews["code.selectable"].firstMatch
        XCTAssertTrue(view.waitForExistence(timeout: 10))
        XCTAssertEqual(view.value as? String, code)
        XCTAssertLessThanOrEqual(view.frame.width, app.frame.width - 32, "等宽长行不能通过撑宽横向滚动区避开换行")
        XCTAssertGreaterThan(view.frame.height, 100, "长代码行须在卡片内完整换行")
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "等宽代码自动换行"; screenshot.lifetime = .keepAlways; add(screenshot)
    }

    func testReleaseReplyRendersListContinuation() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-release-reply-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let body = app.textViews["assistant.selectable"].firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        XCTAssertTrue((body.value as? String)?.contains(digest) == true)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "发布回复-列表续行与SHA"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
