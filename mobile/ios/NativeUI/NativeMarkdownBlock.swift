import Foundation

struct NativeMarkdownBlock: Identifiable {
    var id: Int
    var kind: NativeMarkdownBlockKind
    var text: String
    var language = ""
    var previousKind: NativeMarkdownBlockKind? = nil
    var level = 2
    var marker = "•"
    var depth = 0
    var checked: Bool? = nil
    var destination: String? = nil
    var rows: [[String]] = []
    var spacingBefore: Double { NativeTextRhythm.spacingBefore(kind, after: previousKind) }

    static func parse(_ source: String) -> [Self] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var result: [Self] = []
        var index = 0
        func append(_ kind: NativeMarkdownBlockKind, _ text: String) {
            result.append(Self(id: result.count, kind: kind, text: text, previousKind: result.last?.kind))
        }
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            defer { index += 1 }
            if trimmed.isEmpty { continue }
            if let fence = NativeMarkdownSyntax.fence(trimmed) {
                var code: [String] = []
                index += 1
                while index < lines.count && !NativeMarkdownSyntax.closesFence(lines[index], character: fence.character, count: fence.count) {
                    code.append(lines[index]); index += 1
                }
                append(.code, code.joined(separator: "\n"))
                result[result.count - 1].language = fence.language
            } else if let heading = NativeMarkdownSyntax.groups(line, pattern: "^ {0,3}(#{1,6}) +(.+?) *#* *$") {
                append(.heading, heading[1]); result[result.count - 1].level = heading[0].count
            } else if index + 1 < lines.count, NativeMarkdownSyntax.isTableDelimiter(lines[index + 1]), line.contains("|") {
                var rows = [NativeMarkdownSyntax.tableCells(line)]
                index += 2
                while index < lines.count && lines[index].contains("|") && !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(NativeMarkdownSyntax.tableCells(lines[index])); index += 1
                }
                index -= 1
                append(.table, rows.map { $0.joined(separator: "\t") }.joined(separator: "\n"))
                result[result.count - 1].rows = rows
            } else if NativeMarkdownSyntax.isRule(trimmed) {
                append(.rule, "")
            } else if let list = NativeMarkdownSyntax.groups(line, pattern: "^(\\s*)([-+*]|[0-9]+[.)]) +(.+)$") {
                var text = list[2]
                var checked: Bool?
                if let task = NativeMarkdownSyntax.groups(text, pattern: "^\\[([ xX])\\] +(.*)$") {
                    checked = task[0].lowercased() == "x"; text = task[1]
                }
                append(.list, text)
                result[result.count - 1].marker = list[1].first?.isNumber == true ? list[1] : "•"
                result[result.count - 1].depth = list[0].replacingOccurrences(of: "\t", with: "    ").count / 2
                result[result.count - 1].checked = checked
            } else if trimmed.hasPrefix(">") {
                var quote: [String] = []
                while index < lines.count {
                    let value = lines[index].trimmingCharacters(in: .whitespaces)
                    guard value.hasPrefix(">") else { break }
                    quote.append(String(value.dropFirst()).trimmingCharacters(in: .whitespaces)); index += 1
                }
                index -= 1; append(.quote, quote.joined(separator: "\n"))
            } else if let image = NativeMarkdownSyntax.groups(trimmed, pattern: "^!\\[([^]]*)\\]\\((.+?)(?: +[\"'].*[\"'])?\\)$") {
                append(.image, image[0]); result[result.count - 1].destination = image[1]
            } else if index + 1 < lines.count, NativeMarkdownSyntax.isSetext(lines[index + 1]) {
                append(.heading, line); result[result.count - 1].level = lines[index + 1].contains("=") ? 1 : 2
                index += 1
            } else { append(.text, line) }
        }
        return result
    }
}
