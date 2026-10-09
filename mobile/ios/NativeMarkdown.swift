import Foundation
#if canImport(UIKit)
import UIKit
#endif

enum NativeMarkdownBlock: Equatable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case list(ordered: Bool, items: [String], start: Int = 1)
    case quote(String)
    case code(language: String, text: String)
    case table(headers: [String], rows: [[String]])
    case divider
}

enum NativeMarkdown {
    /// 先识别块结构，再由原生视图分别布局文字、代码和表格。
    static func parse(_ text: String) -> [NativeMarkdownBlock] {
        let source = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = source.components(separatedBy: "\n")
        var blocks: [NativeMarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            if isBlank(line) { index += 1; continue }

            if let fence = openingFence(line) {
                index += 1
                var code = ""
                while index < lines.count, !isClosingFence(lines[index], fence: fence) {
                    code += lines[index]
                    // components 的最后一个元素没有换行，其余行均保留原换行。
                    if index < lines.count - 1 { code += "\n" }
                    index += 1
                }
                if index < lines.count { index += 1 }
                blocks.append(.code(language: fence.language, text: code))
                continue
            }

            if let heading = heading(line) {
                blocks.append(.heading(level: heading.level, text: heading.text))
                index += 1
                continue
            }

            if var headers = tableHeader(lines, at: index) {
                index += 2
                var rows: [[String]] = []
                while index < lines.count, !isBlank(lines[index]), !startsBlock(lines[index]) {
                    // GFM 的短行可以不含竖线，补空列即可；所有额外列也保留。
                    rows.append(tableCells(lines[index]).cells)
                    index += 1
                }
                let width = max(headers.count, rows.map(\.count).max() ?? 0)
                headers += Array(repeating: "", count: width - headers.count)
                rows = rows.map { $0 + Array(repeating: "", count: width - $0.count) }
                blocks.append(.table(headers: headers, rows: rows))
                continue
            }

            if let firstQuote = quoteContent(line) {
                var content = [firstQuote]
                index += 1
                while index < lines.count {
                    if let quoted = quoteContent(lines[index]) {
                        content.append(quoted)
                    } else if !isBlank(lines[index]), !startsBlock(lines[index]), tableHeader(lines, at: index) == nil {
                        content.append(lines[index])
                    } else {
                        break
                    }
                    index += 1
                }
                blocks.append(.quote(content.joined(separator: "\n")))
                continue
            }

            if isDivider(line) {
                blocks.append(.divider)
                index += 1
                continue
            }

            if let firstItem = listMarker(line), firstItem.indent <= 3 {
                let ordered = firstItem.ordered
                let baseIndent = firstItem.indent
                var items = [firstItem.text]
                index += 1
                while index < lines.count {
                    if isBlank(lines[index]) {
                        var next = index
                        while next < lines.count, isBlank(lines[next]) { next += 1 }
                        guard next < lines.count else { break }
                        let marker = listMarker(lines[next])
                        if let marker, marker.indent == baseIndent, marker.ordered == ordered, !isDivider(lines[next]) {
                            // 两个顶层条目间的空行不属于条目正文。
                            index = next
                            continue
                        }
                        guard indentation(lines[next]).columns > baseIndent else { break }
                        items[items.count - 1] += String(repeating: "\n", count: next - index)
                        index = next
                        continue
                    }

                    let indent = indentation(lines[index]).columns
                    if indent > baseIndent {
                        // 保留嵌套 marker 与相对缩进，不能扁平化后丢掉列表层级。
                        items[items.count - 1] += "\n" + removingIndent(lines[index], columns: baseIndent)
                    } else if let marker = listMarker(lines[index]), marker.indent == baseIndent,
                              marker.ordered == ordered, !isDivider(lines[index]) {
                        items.append(marker.text)
                    } else if !startsBlock(lines[index]), tableHeader(lines, at: index) == nil {
                        items[items.count - 1] += "\n" + lines[index]
                    } else {
                        break
                    }
                    index += 1
                }
                blocks.append(.list(ordered: ordered, items: items, start: firstItem.start))
                continue
            }

            var paragraph = [line]
            var setextLevel: Int?
            index += 1
            while index < lines.count, !isBlank(lines[index]) {
                if let level = setextHeadingLevel(lines[index]) {
                    setextLevel = level
                    index += 1
                    break
                }
                if startsBlock(lines[index]) || tableHeader(lines, at: index) != nil { break }
                paragraph.append(lines[index])
                index += 1
            }
            let body = paragraph.joined(separator: "\n")
            if let level = setextLevel {
                blocks.append(.heading(level: level, text: body))
            } else {
                blocks.append(.paragraph(body))
            }
        }
        return blocks
    }

    #if canImport(UIKit)
    /// Foundation 仅解析行内语义，字体与段落指标由原生 UI 的 base font 决定。
    static func inline(_ text: String, font: UIFont, color: UIColor = .label) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        paragraph.paragraphSpacing = 0
        let base: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph
        ]
        guard let parsed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return NSAttributedString(string: text, attributes: base)
        }
        let result = NSMutableAttributedString(string: "")
        for run in parsed.runs {
            var attributes = base
            var traits = font.fontDescriptor.symbolicTraits
            let intent = run.inlinePresentationIntent ?? []
            if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
            if intent.contains(.emphasized) { traits.insert(.traitItalic) }
            var runFont = font
            if intent.contains(.code) {
                let fontTraits = font.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]
                let weight = (fontTraits?[.weight] as? NSNumber).map { UIFont.Weight(rawValue: CGFloat($0.doubleValue)) } ?? .regular
                runFont = .monospacedSystemFont(ofSize: font.pointSize, weight: weight)
                traits.insert(.traitMonoSpace)
                attributes[.backgroundColor] = UIColor.secondarySystemFill
            }
            if let descriptor = runFont.fontDescriptor.withSymbolicTraits(traits) {
                runFont = UIFont(descriptor: descriptor, size: font.pointSize)
            }
            attributes[.font] = runFont
            if let link = run.link { attributes[.link] = link }
            if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            result.append(NSAttributedString(string: String(parsed[run.range].characters), attributes: attributes))
        }
        return result
    }
    #endif

    private struct Fence {
        let marker: Character
        let count: Int
        let language: String
    }

    private struct ListMarker {
        let indent: Int
        let ordered: Bool
        let text: String
        let start: Int
    }

    private static let headingPattern = try! NSRegularExpression(pattern: "^(#{1,6})(?:[ \\t]+(.*?)|[ \\t]*)$")
    private static let headingEndPattern = try! NSRegularExpression(pattern: "[ \\t]+#+[ \\t]*$")
    private static let listPattern = try! NSRegularExpression(pattern: "^([-+*]|[0-9]{1,9}[.)])(?:[ \\t]+(.*)|$)")

    private static func isBlank(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static func indentation(_ line: String) -> (columns: Int, end: String.Index) {
        var columns = 0
        var end = line.startIndex
        while end < line.endIndex {
            if line[end] == " " { columns += 1 }
            else if line[end] == "\t" { columns += 4 - columns % 4 }
            else { break }
            end = line.index(after: end)
        }
        return (columns, end)
    }

    private static func blockContent(_ line: String) -> String? {
        let indent = indentation(line)
        guard indent.columns <= 3 else { return nil }
        return String(line[indent.end...])
    }

    private static func removingIndent(_ line: String, columns: Int) -> String {
        var removed = 0
        var index = line.startIndex
        while index < line.endIndex, removed < columns {
            if line[index] == " " { removed += 1 }
            else if line[index] == "\t" { removed += 4 - removed % 4 }
            else { break }
            index = line.index(after: index)
        }
        // tab 跨过基准列时补回其余缩进，保持相对层级。
        return String(repeating: " ", count: max(0, removed - columns)) + line[index...]
    }

    private static func openingFence(_ line: String) -> Fence? {
        guard let content = blockContent(line), let marker = content.first, marker == "`" || marker == "~" else { return nil }
        let count = content.prefix(while: { $0 == marker }).count
        guard count >= 3 else { return nil }
        let info = content.dropFirst(count).trimmingCharacters(in: .whitespaces)
        guard marker != "`" || !info.contains("`") else { return nil }
        return Fence(marker: marker, count: count, language: String(info.split(whereSeparator: \.isWhitespace).first ?? ""))
    }

    private static func isClosingFence(_ line: String, fence: Fence) -> Bool {
        guard let content = blockContent(line) else { return false }
        let count = content.prefix(while: { $0 == fence.marker }).count
        return count >= fence.count && content.dropFirst(count).trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static func heading(_ line: String) -> (level: Int, text: String)? {
        guard let content = blockContent(line), let match = headingPattern.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let markerRange = Range(match.range(at: 1), in: content) else { return nil }
        let raw = Range(match.range(at: 2), in: content).map { String(content[$0]) } ?? ""
        let onlyClosingMarker = raw.trimmingCharacters(in: .whitespaces).allSatisfy { $0 == "#" }
        let body = onlyClosingMarker ? "" : headingEndPattern.stringByReplacingMatches(in: raw, range: NSRange(raw.startIndex..., in: raw), withTemplate: "")
        return (content[markerRange].count, body.trimmingCharacters(in: .whitespaces))
    }

    private static func setextHeadingLevel(_ line: String) -> Int? {
        guard let content = blockContent(line)?.trimmingCharacters(in: .whitespaces), let marker = content.first,
              marker == "=" || marker == "-", content.allSatisfy({ $0 == marker }) else { return nil }
        return marker == "=" ? 1 : 2
    }

    private static func isDivider(_ line: String) -> Bool {
        guard let content = blockContent(line) else { return false }
        let compact = content.filter { $0 != " " && $0 != "\t" }
        guard compact.count >= 3, let marker = compact.first, marker == "*" || marker == "-" || marker == "_" else { return false }
        return compact.allSatisfy { $0 == marker }
    }

    private static func quoteContent(_ line: String) -> String? {
        guard let content = blockContent(line), content.first == ">" else { return nil }
        var body = content.dropFirst()
        if body.first == " " || body.first == "\t" { body = body.dropFirst() }
        return String(body)
    }

    private static func listMarker(_ line: String) -> ListMarker? {
        let indent = indentation(line)
        let content = String(line[indent.end...])
        guard let match = listPattern.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let markerRange = Range(match.range(at: 1), in: content) else { return nil }
        let body = Range(match.range(at: 2), in: content).map { String(content[$0]) } ?? ""
        let marker = content[markerRange]
        let ordered = marker.first?.isNumber == true
        let start = ordered ? Int(marker.dropLast()) ?? 1 : 1
        return ListMarker(indent: indent.columns, ordered: ordered, text: body, start: start)
    }

    private static func startsBlock(_ line: String) -> Bool {
        openingFence(line) != nil || heading(line) != nil || quoteContent(line) != nil || isDivider(line)
            || (listMarker(line).map { $0.indent <= 3 } ?? false)
    }

    private static func tableHeader(_ lines: [String], at index: Int) -> [String]? {
        guard index + 1 < lines.count, blockContent(lines[index]) != nil else { return nil }
        let header = tableCells(lines[index])
        let separator = tableCells(lines[index + 1])
        guard header.hasPipe, header.cells.count == separator.cells.count,
              !header.cells.isEmpty, separator.cells.allSatisfy(isTableSeparator) else { return nil }
        return header.cells
    }

    private static func isTableSeparator(_ cell: String) -> Bool {
        var content = cell[...]
        if content.first == ":" { content = content.dropFirst() }
        if content.last == ":" { content = content.dropLast() }
        return !content.isEmpty && content.allSatisfy { $0 == "-" }
    }

    /// 只在代码 span 外拆竖线；转义仍交给 inline parser，代码内的 \| 则先解转义。
    private static func tableCells(_ line: String) -> (cells: [String], hasPipe: Bool) {
        let characters = Array(line)
        var cells: [String] = []
        var current = ""
        var index = 0
        var hasPipe = false
        while index < characters.count {
            let character = characters[index]
            if character == "\\", index + 1 < characters.count {
                current.append(character)
                current.append(characters[index + 1])
                index += 2
                continue
            }
            if character == "`" {
                let count = backtickCount(characters, at: index)
                if let close = closingBackticks(characters, after: index + count, count: count) {
                    current += String(characters[index..<(index + count)])
                    var codeIndex = index + count
                    while codeIndex < close {
                        if characters[codeIndex] == "\\", codeIndex + 1 < close, characters[codeIndex + 1] == "|" {
                            current.append("|")
                            codeIndex += 2
                        } else {
                            current.append(characters[codeIndex])
                            codeIndex += 1
                        }
                    }
                    current += String(characters[close..<(close + count)])
                    index = close + count
                    continue
                }
                current += String(characters[index..<(index + count)])
                index += count
                continue
            }
            if character == "|" {
                hasPipe = true
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(character)
            }
            index += 1
        }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        if hasPipe, cells.first == "" { cells.removeFirst() }
        if hasPipe, cells.last == "" { cells.removeLast() }
        return (cells, hasPipe)
    }

    private static func backtickCount(_ characters: [Character], at index: Int) -> Int {
        var end = index
        while end < characters.count, characters[end] == "`" { end += 1 }
        return end - index
    }

    private static func closingBackticks(_ characters: [Character], after start: Int, count: Int) -> Int? {
        var index = start
        while index < characters.count {
            if characters[index] == "`" {
                let found = backtickCount(characters, at: index)
                if found == count { return index }
                index += found
            } else {
                index += 1
            }
        }
        return nil
    }
}
