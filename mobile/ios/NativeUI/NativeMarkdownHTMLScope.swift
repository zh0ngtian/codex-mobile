import Foundation

struct NativeMarkdownHTMLScope: Hashable {
    private(set) var tags: [String] = []
    private var verbatimEnd: String?
    private var pendingTag: String?
    var containsHTML: Bool { !tags.isEmpty || needsContinuation }
    var isVerbatim: Bool { verbatimEnd != nil }
    var needsContinuation: Bool { isVerbatim || pendingTag != nil }
    var identity: [String] { tags + [verbatimEnd ?? "", pendingTag ?? ""] }

    func advancing(over source: String) -> Self {
        NativeMarkdownDisplaySource(source, scope: self).endingScope
    }

    mutating func consumePrefix(_ source: String) -> Int? {
        if let pending = pendingTag {
            let combined = pending + "\n" + source
            if let length = consumeTag(combined) {
                pendingTag = nil
                return length - pending.count - 1
            }
            pendingTag = combined
            return source.count
        }
        if let closing = verbatimEnd {
            if let end = source.range(of: closing)?.upperBound {
                verbatimEnd = nil
                return source[..<end].count
            }
            return source.count
        }
        for (opening, closing) in [("<!--", "-->"), ("<![CDATA[", "]]>"), ("<?", "?>")] where source.hasPrefix(opening) {
            if let end = source.range(of: closing)?.upperBound { return source[..<end].count }
            verbatimEnd = closing
            return source.count
        }
        if source.hasPrefix("<!") {
            let end = source.firstIndex(of: ">").map { source.index(after: $0) } ?? source.endIndex
            return source[..<end].count
        }
        if let length = consumeTag(source) { return length }
        if source.range(of: #"^</?[A-Za-z][A-Za-z0-9-]*(?:\s|$)"#, options: .regularExpression) != nil {
            pendingTag = source
            return source.count
        }
        if source.hasPrefix("<http://") || source.hasPrefix("<https://"), let end = source.firstIndex(of: ">") {
            return source.distance(from: source.startIndex, to: end) + 1
        }
        return nil
    }

    private mutating func consumeTag(_ source: String) -> Int? {
        let pattern = #"^<(/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^"'<>])*>"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
              let range = Range(match.range, in: source), let nameRange = Range(match.range(at: 2), in: source) else { return nil }
        let name = source[nameRange].lowercased()
        let tag = String(source[range])
        let voids = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]
        if source.hasPrefix("</") {
            if let index = tags.lastIndex(of: name) { tags.removeSubrange(index...) }
        } else if !tag.hasSuffix("/>") && !voids.contains(name) { tags.append(name) }
        return tag.count
    }
}
