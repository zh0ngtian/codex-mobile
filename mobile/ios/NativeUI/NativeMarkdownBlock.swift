import Foundation

struct NativeMarkdownBlock: Identifiable {
    var id: Int
    var kind: String
    var text: String
    var language: String = ""
    static func parse(_ source: String) -> [Self] {
        var result: [Self] = []
        var code: [String] = []
        var language: String? = nil
        for line in source.components(separatedBy: .newlines) {
            if line.hasPrefix("```") {
                if let current = language {
                    result.append(Self(id: result.count, kind: "code", text: code.joined(separator: "\n"), language: current))
                    code = []; language = nil
                } else { language = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
            } else if language != nil { code.append(line) }
            else if line.hasPrefix("## ") { result.append(Self(id: result.count, kind: "heading", text: String(line.dropFirst(3)))) }
            else if line.hasPrefix("# ") { result.append(Self(id: result.count, kind: "heading", text: String(line.dropFirst(2)))) }
            else if line.hasPrefix("- ") || line.hasPrefix("* ") { result.append(Self(id: result.count, kind: "list", text: String(line.dropFirst(2)))) }
            else if !line.trimmingCharacters(in: .whitespaces).isEmpty { result.append(Self(id: result.count, kind: "text", text: line)) }
        }
        if let language { result.append(Self(id: result.count, kind: "code", text: code.joined(separator: "\n"), language: language)) }
        return result
    }
}
