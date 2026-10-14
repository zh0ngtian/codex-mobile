import Foundation

struct NativeMarkdownBlock: Identifiable {
    var id: Int
    var kind: NativeMarkdownBlockKind
    var text: String
    var language: String = ""
    var previousKind: NativeMarkdownBlockKind? = nil
    var spacingBefore: Double { NativeTextRhythm.spacingBefore(kind, after: previousKind) }
    static func parse(_ source: String) -> [Self] {
        var result: [Self] = []
        var code: [String] = []
        var language: String? = nil
        func append(_ kind: NativeMarkdownBlockKind, _ text: String, language: String = "") {
            result.append(Self(id: result.count, kind: kind, text: text, language: language, previousKind: result.last?.kind))
        }
        for line in source.components(separatedBy: .newlines) {
            if line.hasPrefix("```") {
                if let current = language {
                    append(.code, code.joined(separator: "\n"), language: current)
                    code = []; language = nil
                } else { language = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
            } else if language != nil { code.append(line) }
            else if line.hasPrefix("## ") { append(.heading, String(line.dropFirst(3))) }
            else if line.hasPrefix("# ") { append(.heading, String(line.dropFirst(2))) }
            else if line.hasPrefix("- ") || line.hasPrefix("* ") { append(.list, String(line.dropFirst(2))) }
            else if !line.trimmingCharacters(in: .whitespaces).isEmpty { append(.text, line) }
        }
        if let language { append(.code, code.joined(separator: "\n"), language: language) }
        return result
    }
}
