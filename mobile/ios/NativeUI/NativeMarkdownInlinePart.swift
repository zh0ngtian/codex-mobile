import Foundation

struct NativeMarkdownInlinePart: Identifiable {
    var id: String
    var text: String
    var destination: String?
    private static let images = try? NSRegularExpression(pattern: #"!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)"#)
    static func parse(_ source: String) -> [Self] {
        guard let images else { return [Self(id: "text:0", text: source)] }
        let code = codeRanges(source)
        var result: [Self] = []
        var cursor = source.startIndex
        for match in images.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
            guard let range = Range(match.range, in: source), !escaped(source, at: range.lowerBound),
                  !code.contains(where: { $0.contains(range.lowerBound) }),
                  let alt = Range(match.range(at: 1), in: source), let href = Range(match.range(at: 2), in: source) else { continue }
            if cursor < range.lowerBound { result.append(Self(id: "text:\(cursor.utf16Offset(in: source))", text: String(source[cursor..<range.lowerBound]))) }
            var destination = String(source[href])
            if destination.hasPrefix("<"), destination.hasSuffix(">") { destination = String(destination.dropFirst().dropLast()) }
            result.append(Self(id: "image:\(match.range.location)", text: String(source[alt]), destination: destination))
            cursor = range.upperBound
        }
        if cursor < source.endIndex || result.isEmpty { result.append(Self(id: "text:\(cursor.utf16Offset(in: source))", text: String(source[cursor...]))) }
        return result
    }
    private static func escaped(_ source: String, at index: String.Index) -> Bool {
        var cursor = index, count = 0
        while cursor > source.startIndex {
            let previous = source.index(before: cursor)
            guard source[previous] == "\\" else { break }
            count += 1; cursor = previous
        }
        return count % 2 == 1
    }
    private static func codeRanges(_ source: String) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var cursor = source.startIndex
        var open: (String.Index, Int)?
        while cursor < source.endIndex {
            guard source[cursor] == "`", open != nil || !escaped(source, at: cursor) else { cursor = source.index(after: cursor); continue }
            let start = cursor
            var count = 0
            while cursor < source.endIndex && source[cursor] == "`" { count += 1; cursor = source.index(after: cursor) }
            if let current = open {
                if count == current.1 { ranges.append(current.0..<cursor); open = nil }
            } else { open = (start, count) }
        }
        return ranges
    }
}
