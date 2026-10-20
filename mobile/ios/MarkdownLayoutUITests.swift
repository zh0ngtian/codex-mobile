import XCTest
import UIKit

@MainActor final class MarkdownLayoutUITests: XCTestCase {
    private let digest = "bd309dfa76a14e11957cd035f976372b22fd7e1e4dea46569008a55cff820a07"

    private func setCodeWrapping(_ enabled: Bool, in app: XCUIApplication) {
        app.buttons["会话列表"].tap()
        app.buttons["sidebar.more"].tap()
        app.buttons["设置"].tap()
        let toggle = app.switches["settings.code-wrap"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        if !toggle.isHittable { app.swipeUp() }
        if (toggle.value as? String == "1") != enabled {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        }
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", enabled ? "1" : "0"), object: toggle)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = enabled ? "全局代码换行-开启" : "全局代码换行-关闭"
        screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["settings.close"].tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.3)).tap()
    }

    private func layout(_ source: String, width: CGFloat = 350) -> (NSAttributedString, NSLayoutManager, NSTextContainer) {
        let text = NativeSystemTypography.resolved(NativeSelectableMarkdown.blocks(NativeMarkdownBlock.parse(source)), size: .large, bold: false)
        let storage = NSTextStorage(attributedString: text)
        let manager = NativeInlineCodeLayoutManager()
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

    func testInlineCodeUsesRemainingLineWidthAndKeepsOriginalText() {
        for source in ["Text before `abcdefghijklmnop` end", "Text before ``abcdefghijklmnop`` end",
                       "- Text before `abcdefghijklmnop` end", "> Text before `abcdefghijklmnop` end"] {
            let (text, manager, _) = layout(source, width: 240)
            let prefix = origin("Text", text: text, manager: manager)
            let first = origin("abcd", text: text, manager: manager)
            let last = origin("p", text: text, manager: manager)
            XCTAssertEqual(first.y, prefix.y, accuracy: 0.5, "行内代码须利用当前行剩余空间，不能整词移到下一行")
            XCTAssertGreaterThan(last.y, first.y, "行内代码内部须允许断行")
            XCTAssertEqual(text.string, source.hasPrefix("- ") ? "• Text before abcdefghijklmnop end" : "Text before abcdefghijklmnop end")
            let codeRange = (text.string as NSString).range(of: "abcdefghijklmnop")
            var line = 0
            manager.enumerateLineFragments(forGlyphRange: manager.glyphRange(forCharacterRange: codeRange, actualCharacterRange: nil)) { _, used, _, _, _ in
                if line > 0 { XCTAssertGreaterThanOrEqual(used.minX, prefix.x - 0.5, "代码续行须保留列表或引用正文的缩进") }
                line += 1
            }
        }
    }

    func testOrdinaryWordsStillWrapAtWordBoundariesBesideInlineCode() {
        let (text, manager, _) = layout("Text before abcdefghijklmnop\n\nText before `abcdefghijklmnop`\n\nText before abcdefghijklmnop", width: 240)
        let string = text.string as NSString
        let paragraphs = string.components(separatedBy: "\n")
        var offset = 0
        for (index, paragraph) in paragraphs.enumerated() {
            let range = (paragraph as NSString).range(of: "abcdefghijklmnop")
            let glyph = manager.glyphIndexForCharacter(at: offset + range.location)
            let endGlyph = manager.glyphIndexForCharacter(at: offset + NSMaxRange(range) - 1)
            let firstLine = manager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let lastLine = manager.lineFragmentRect(forGlyphAt: endGlyph, effectiveRange: nil)
            if index == 1 { XCTAssertGreaterThan(lastLine.minY, firstLine.minY) }
            else { XCTAssertEqual(lastLine.minY, firstLine.minY, accuracy: 0.5, "普通英文仍按完整单词换行") }
            offset += (paragraph as NSString).length + 1
        }
    }

    func testInlineCodeWrappingRendersInConversation() {
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-inline-code-wrap-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let body = app.textViews["assistant.selectable"].firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        let value = body.value as? String ?? ""
        XCTAssertTrue(value.contains("abcdefghijklmnop"), "视觉折行仍须保留连续的原始标识符")
        XCTAssertFalse(value.contains("\u{200B}"), "不能插入零宽字符改变复制或选文范围")
        XCTAssertLessThanOrEqual(body.frame.width, app.frame.width - 32)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "行内代码按剩余宽度断行"; screenshot.lifetime = .keepAlways; add(screenshot)
    }

    func testInlineCodeWithSpacesKeepsFollowingWordsIntactAfterRelayout() {
        let (text, manager, container) = layout("Text before `abcd efghijklmnop` ordinarywordsandmore", width: 240)
        for width: CGFloat in [240, 220, 240] {
            container.size.width = width
            manager.ensureLayout(for: container)
            XCTAssertEqual(origin("abcd", text: text, manager: manager).y,
                           origin("Text", text: text, manager: manager).y, accuracy: 0.5)
            XCTAssertEqual(origin("ordinary", text: text, manager: manager).y,
                           origin("andmore", text: text, manager: manager).y, accuracy: 0.5, "代码后的普通单词不能被逐字断开")
            XCTAssertEqual(text.string, "Text before abcd efghijklmnop ordinarywordsandmore")
        }
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
        continueAfterFailure = false
        let token = String(repeating: "0123456789abcdef", count: 16)
        let code = token + "\nreturn " + String(repeating: "TOKEN_", count: 32)
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-monospace-wrap-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        setCodeWrapping(true, in: app)
        let view = app.textViews["code.selectable"].firstMatch
        XCTAssertTrue(view.waitForExistence(timeout: 10))
        XCTAssertEqual(view.value as? String, code)
        XCTAssertLessThanOrEqual(view.frame.width, app.frame.width - 32, "等宽长行不能通过撑宽横向滚动区避开换行")
        XCTAssertGreaterThan(view.frame.height, 100, "长代码行须在卡片内完整换行")
        XCTAssertFalse(app.switches["code.wrap-toggle"].exists, "代码块内不再提供换行开关")
        XCTAssertFalse(app.switches["settings.code-wrap"].exists, "全局开关只出现在设置页面")
        let wrappedHeight = view.frame.height
        setCodeWrapping(false, in: app)
        XCTAssertGreaterThan(view.frame.width, app.frame.width, "关闭换行后保留原始长行并允许横向滚动")
        XCTAssertLessThan(view.frame.height, wrappedHeight)
        XCTAssertEqual(view.value as? String, code, "切换不得插入换行或改写代码")
        let unwrapped = XCTAttachment(screenshot: app.screenshot()); unwrapped.name = "代码关闭换行"; unwrapped.lifetime = .keepAlways; add(unwrapped)
        let originalX = view.frame.minX
        view.swipeLeft()
        XCTAssertLessThan(view.frame.minX, originalX, "关闭换行后须能实际横向滚动代码")
        XCTAssertEqual(view.value as? String, code)
        setCodeWrapping(true, in: app)
        XCTAssertLessThanOrEqual(view.frame.width, app.frame.width - 32)
        XCTAssertEqual(view.frame.height, wrappedHeight, accuracy: 1)
        XCTAssertEqual(view.value as? String, code)
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

    func testGlobalCodeWrappingAppliesToAllBlocksPersistsAndCopyKeepsOriginalLines() {
        continueAfterFailure = false
        let code = String(repeating: "abcdef0123456789", count: 6) + "\nend"
        let app = XCUIApplication()
        app.launchArguments = ["--native-ui-live", "--agent-conversation-fixture", "--agent-code-wrap-toggle-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        setCodeWrapping(true, in: app)
        let first = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value == %@", "code.selectable", code)).firstMatch
        let second = app.textViews.matching(NSPredicate(format: "identifier == %@ AND value == %@", "code.selectable", "second_" + code)).firstMatch
        XCTAssertTrue(second.waitForExistence(timeout: 10))
        let secondHeight = second.frame.height
        setCodeWrapping(false, in: app)
        XCTAssertGreaterThan(first.frame.width, app.frame.width)
        XCTAssertGreaterThan(second.frame.width, app.frame.width, "全局设置同时作用于所有代码块")
        XCTAssertLessThan(second.frame.height, secondHeight)
        app.terminate(); app.launch()
        XCTAssertTrue(second.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(first.frame.width, app.frame.width, "重启保留关闭换行的选择")
        XCTAssertGreaterThan(second.frame.width, app.frame.width)
        XCTAssertFalse(app.switches["code.wrap-toggle"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "全局代码换行-重启保留多块设置"; screenshot.lifetime = .keepAlways; add(screenshot)

        app.buttons.matching(identifier: "code.copy").element(boundBy: 0).tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap(); input.press(forDuration: 1.2)
        let paste = app.menuItems.matching(NSPredicate(format: "label IN %@", ["粘贴", "Paste"])).firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
        paste.tap()
        XCTAssertEqual(input.value as? String, code, "关闭换行后的复制必须保留完整长行与原始换行")
    }
}
