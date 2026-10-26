import UIKit
import SwiftUI

extension NSAttributedString.Key {
    static let nativeFontStyle = NSAttributedString.Key("CodexMobileFontStyle")
    static let nativeStrong = NSAttributedString.Key("CodexMobileStrong")
    static let nativeItalic = NSAttributedString.Key("CodexMobileItalic")
    static let nativeMonospaced = NSAttributedString.Key("CodexMobileMonospaced")
    static let nativeInlineCode = NSAttributedString.Key("CodexMobileInlineCode")
    static let nativeQuoteRule = NSAttributedString.Key("CodexMobileQuoteRule")
}

@MainActor enum NativeSelectableMarkdown {
    static func inline(_ source: String, scope: NativeMarkdownHTMLScope = .init(), font: UIFont = .preferredFont(forTextStyle: .body), color: UIColor = .label, strong: Bool = false) -> NSAttributedString {
        let value = NativeInlineMarkdown.text(source, scope: scope)
        let result = NSMutableAttributedString(string: String(value.characters))
        for run in value.runs {
            let start = String(value[..<run.range.lowerBound].characters).utf16.count
            let length = String(value[run.range].characters).utf16.count
            let range = NSRange(location: start, length: length)
            let intent = run.inlinePresentationIntent ?? []
            var selectedFont = intent.contains(.code) ? UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular) : font
            var traits = selectedFont.fontDescriptor.symbolicTraits
            if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
            if intent.contains(.emphasized) { traits.insert(.traitItalic) }
            if let descriptor = selectedFont.fontDescriptor.withSymbolicTraits(traits) {
                selectedFont = UIFont(descriptor: descriptor, size: selectedFont.pointSize)
            }
            result.addAttributes([.font: selectedFont, .foregroundColor: intent.contains(.code) ? UIColor.secondaryLabel : color,
                                  .nativeFontStyle: font.fontDescriptor.object(forKey: .textStyle) as? String ?? UIFont.TextStyle.body.rawValue,
                                  .nativeStrong: strong || intent.contains(.stronglyEmphasized),
                                  .nativeItalic: intent.contains(.emphasized), .nativeMonospaced: intent.contains(.code),
                                  .nativeInlineCode: intent.contains(.code)], range: range)
            if let link = run.link {
                result.addAttributes([.link: link, .foregroundColor: UIColor.label,
                                      .underlineStyle: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue], range: range)
            }
            if intent.contains(.strikethrough) { result.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: range) }
        }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 3
        result.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: result.length))
        return result
    }

    static func code(_ source: String, language: String? = nil, color: UIColor = .label) -> NSAttributedString {
        let font = UIFont.monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize, weight: .regular)
        let result = NSMutableAttributedString(string: source, attributes: [.font: font, .foregroundColor: color, .nativeStrong: false, .nativeMonospaced: true, .nativeFontStyle: UIFont.TextStyle.body.rawValue])
        if let language {
            let diff = language.lowercased() == "diff"
            let pattern = diff ? "(?m)^[+-].*$" : #""(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'"#
            if let expression = try? NSRegularExpression(pattern: pattern) {
                for match in expression.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
                    let addition = diff && (source as NSString).substring(with: match.range).hasPrefix("+")
                    result.addAttribute(.foregroundColor, value: addition ? UIColor.systemGreen : UIColor.systemRed, range: match.range)
                }
            }
        }
        return result
    }

    static func blocks(_ blocks: [NativeMarkdownBlock]) -> NSAttributedString {
        let result = NSMutableAttributedString(string: "")
        for (index, block) in blocks.enumerated() {
            // 标题保留正文基准字号，用独立的 strong 语义表达字重。
            let font = UIFont.preferredFont(forTextStyle: .body)
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = 3
            paragraph.paragraphSpacing = index == blocks.count - 1 ? 0 : block.kind == .heading ? 8 : blocks[index + 1].kind == .heading ? 24 : 16
            if block.kind == .list, block.marker == "•", index + 1 < blocks.count,
               blocks[index + 1].kind == .list, blocks[index + 1].marker == "•" {
                paragraph.paragraphSpacing = 0
            }
            let part = NSMutableAttributedString(string: "")
            if block.kind == .list {
                let marker = block.checked.map { $0 ? "☑" : "☐" } ?? block.marker
                let prefix = marker + " "
                part.append(NSAttributedString(string: prefix, attributes: [.font: font, .foregroundColor: UIColor.secondaryLabel]))
                paragraph.firstLineHeadIndent = CGFloat(block.depth) * 16
                paragraph.headIndent = paragraph.firstLineHeadIndent + (prefix as NSString).size(withAttributes: [.font: font]).width
            }
            if block.kind == .quote { paragraph.firstLineHeadIndent = 14; paragraph.headIndent = 14 }
            part.append(inline(block.text, scope: block.scope, font: font, color: block.kind == .quote ? .secondaryLabel : .label, strong: block.kind == .heading))
            if index < blocks.count - 1 { part.append(NSAttributedString(string: "\n", attributes: [.font: font])) }
            let range = NSRange(location: 0, length: part.length)
            part.addAttribute(.paragraphStyle, value: paragraph, range: range)
            if block.kind == .list {
                // 换行后的段落首行与列表正文一致；条目标记只占第一行的位置。
                var offset = 0
                let string = part.string as NSString
                while offset < part.length {
                    let line = string.paragraphRange(for: NSRange(location: offset, length: 0))
                    let style = paragraph.mutableCopy() as! NSMutableParagraphStyle
                    if offset > 0 { style.firstLineHeadIndent = style.headIndent }
                    if NSMaxRange(line) < part.length { style.paragraphSpacing = 0 }
                    part.addAttribute(.paragraphStyle, value: style, range: line)
                    offset = NSMaxRange(line)
                }
            }
            if block.kind == .quote { part.addAttribute(.nativeQuoteRule, value: true, range: range) }
            result.append(part)
        }
        return result
    }
}
