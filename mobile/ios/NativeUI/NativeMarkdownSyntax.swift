import Foundation

enum NativeMarkdownSyntax {
    private static let expressions: NSCache<NSString, NSRegularExpression> = {
        let cache = NSCache<NSString, NSRegularExpression>()
        cache.countLimit = 16
        return cache
    }()
    static func groups(_ text: String, pattern: String) -> [String]? {
        let expression: NSRegularExpression
        if let cached = expressions.object(forKey: pattern as NSString) { expression = cached }
        else {
            guard let compiled = try? NSRegularExpression(pattern: pattern) else { return nil }
            expressions.setObject(compiled, forKey: pattern as NSString)
            expression = compiled
        }
        guard let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (1..<match.numberOfRanges).map { index in
            guard let range = Range(match.range(at: index), in: text) else { return "" }
            return String(text[range])
        }
    }
    static func fence(_ text: String) -> (character: Character, count: Int, language: String)? {
        guard let first = text.first, first == "`" || first == "~" else { return nil }
        let count = text.prefix(while: { $0 == first }).count
        guard count >= 3 else { return nil }
        return (first, count, String(text.dropFirst(count)).trimmingCharacters(in: .whitespaces))
    }
    static func closesFence(_ text: String, character: Character, count: Int) -> Bool {
        let value = text.trimmingCharacters(in: .whitespaces)
        return value.count >= count && value.allSatisfy { $0 == character }
    }
    static func isRule(_ text: String) -> Bool {
        let value = text.filter { !$0.isWhitespace }
        guard value.count >= 3, let first = value.first, "-*_".contains(first) else { return false }
        return value.allSatisfy { $0 == first }
    }
    static func isSetext(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespaces)
        guard let first = value.first, first == "=" || first == "-" else { return false }
        return value.allSatisfy { $0 == first }
    }
    static func isTableDelimiter(_ text: String) -> Bool {
        let cells = tableCells(text)
        return !cells.isEmpty && cells.allSatisfy { cell in
            let content = cell.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            return content.count >= 3 && content.allSatisfy { $0 == "-" }
        }
    }
    static func tableCells(_ text: String) -> [String] {
        var value = text.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("|") { value.removeFirst() }
        if value.hasSuffix("|") { value.removeLast() }
        var cells: [String] = [], current = ""
        var escaped = false, code = false
        for character in value {
            if escaped { current.append(character); escaped = false }
            else if character == "\\" { escaped = true }
            else if character == "`" { code.toggle(); current.append(character) }
            else if character == "|" && !code { cells.append(current.trimmingCharacters(in: .whitespaces)); current = "" }
            else { current.append(character) }
        }
        if escaped { current.append("\\") }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells
    }
}
