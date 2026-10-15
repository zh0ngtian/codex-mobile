import Foundation

struct NativeMarkdownInlinePart: Identifiable {
    var id: String
    var text: String
    var destination: String?
    var scope = NativeMarkdownHTMLScope()
    private static let images = try? NSRegularExpression(pattern: #"!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)"#)
    static func parse(_ source: String, scope: NativeMarkdownHTMLScope = .init()) -> [Self] {
        guard let images else { return [Self(id: "text:0", text: source, scope: scope)] }
        let imageRanges = NativeMarkdownDisplaySource(source, scope: scope).inlineImageRanges
        var result: [Self] = []
        var currentScope = scope
        func appendText(_ text: String, at offset: Int) {
            result.append(Self(id: "text:\(offset)", text: text, scope: currentScope))
            currentScope = currentScope.advancing(over: text)
        }
        var cursor = source.startIndex
        for match in images.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
            guard let range = Range(match.range, in: source), imageRanges.contains(range),
                  let alt = Range(match.range(at: 1), in: source), let href = Range(match.range(at: 2), in: source) else { continue }
            if cursor < range.lowerBound { appendText(String(source[cursor..<range.lowerBound]), at: cursor.utf16Offset(in: source)) }
            var destination = String(source[href])
            if destination.hasPrefix("<"), destination.hasSuffix(">") { destination = String(destination.dropFirst().dropLast()) }
            result.append(Self(id: "image:\(match.range.location)", text: String(source[alt]), destination: destination, scope: currentScope))
            cursor = range.upperBound
        }
        if cursor < source.endIndex || result.isEmpty { appendText(String(source[cursor...]), at: cursor.utf16Offset(in: source)) }
        return result
    }
}
