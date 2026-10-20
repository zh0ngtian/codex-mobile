import Foundation

struct MarkdownBlock: Identifiable {
    let id: Int
    let kind: String
    let text: String

    static func parse(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var code: [String]? = nil
        var codeStart = 0
        for (index, line) in source.components(separatedBy: .newlines).enumerated() {
            if line.hasPrefix("```") {
                if let code {
                    blocks.append(MarkdownBlock(id: codeStart, kind: "code", text: code.joined(separator: "\n")))
                } else { codeStart = index }
                code = code == nil ? [] : nil
            } else if code != nil {
                code?.append(line)
            } else if !line.trimmingCharacters(in: .whitespaces).isEmpty {
                let kind: String
                let text: String
                if line.hasPrefix("### ") { kind = "heading3"; text = String(line.dropFirst(4)) }
                else if line.hasPrefix("## ") { kind = "heading2"; text = String(line.dropFirst(3)) }
                else if line.hasPrefix("# ") { kind = "heading1"; text = String(line.dropFirst(2)) }
                else if line.hasPrefix("- ") || line.hasPrefix("* ") { kind = "bullet"; text = String(line.dropFirst(2)) }
                else if line.hasPrefix("> ") { kind = "quote"; text = String(line.dropFirst(2)) }
                else { kind = "paragraph"; text = line }
                blocks.append(MarkdownBlock(id: index, kind: kind, text: text))
            }
        }
        if let code { blocks.append(MarkdownBlock(id: codeStart, kind: "code", text: code.joined(separator: "\n"))) }
        return blocks
    }
}
