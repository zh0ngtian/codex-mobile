import Foundation

/// 只为原生展示准备 Foundation 输入，解析后恢复原字符；不修改消息原文或 JS 命令。
struct NativeMarkdownDisplaySource {
    let markdown: String
    let endingScope: NativeMarkdownHTMLScope
    let inlineImageRanges: Set<Range<String.Index>>
    private let replacements: [(marker: String, text: String, link: URL?)]

    init(_ source: String, scope: NativeMarkdownHTMLScope = .init()) {
        let characters = Array(source)
        let prefix = "CodexDisplay" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        var output = ""
        var substitutions: [(marker: String, text: String, link: URL?)] = []
        var htmlScope = scope
        var imageRanges: Set<Range<String.Index>> = []
        var cursor = 0
        func substitute(_ text: String, link: URL? = nil) {
            let marker = prefix + "R" + String(substitutions.count) + "End"
            substitutions.append((marker, text, link))
            output += marker
        }
        while cursor < characters.count {
            let character = characters[cursor]
            if htmlScope.needsContinuation, let length = htmlScope.consumePrefix(String(characters[cursor...])) {
                output += String(characters[cursor..<cursor + length]); cursor += length; continue
            }
            if character == "\\", cursor + 1 < characters.count {
                output += String(characters[cursor...cursor + 1]); cursor += 2; continue
            }
            if character == "`", let end = Self.codeEnd(characters, from: cursor) {
                output += String(characters[cursor..<end]); cursor = end; continue
            }
            if character == "<", let length = htmlScope.consumePrefix(String(characters[cursor...])) {
                output += String(characters[cursor..<cursor + length]); cursor += length; continue
            }
            if character == "!", cursor + 1 < characters.count, characters[cursor + 1] == "[",
               let link = Self.linkEnd(characters, from: cursor + 1) {
                imageRanges.insert(source.index(source.startIndex, offsetBy: cursor)..<source.index(source.startIndex, offsetBy: link.end))
                output += String(characters[cursor..<link.end]); cursor = link.end; continue
            }
            if character == "[", let link = Self.linkEnd(characters, from: cursor) {
                // 链接标签禁止引用转换，但其中真实 HTML 标签仍影响后续文档范围。
                htmlScope = htmlScope.advancing(over: String(characters[cursor + 1..<link.labelEnd]))
                output += String(characters[cursor..<link.end]); cursor = link.end; continue
            }
            if Self.hasPrefix("https://", characters, at: cursor) || Self.hasPrefix("http://", characters, at: cursor) {
                let end = characters[cursor...].firstIndex(where: { $0.isWhitespace }) ?? characters.count
                output += String(characters[cursor..<end]); cursor = end; continue
            }
            if !htmlScope.containsHTML, character == ":", cursor == 0 || characters[cursor - 1] != ":",
               let start = Self.citationStart(characters, at: cursor) {
                let end = Self.citationEnd(characters, from: start)
                let original = String(characters[cursor..<end.offset])
                if end.complete, let path = Self.citationPath(String(characters[start..<end.offset - 1])), let link = Self.fileURL(path) {
                    substitute(path.components(separatedBy: "/").last ?? path, link: link)
                } else {
                    // 一个候选失败后整体保留，不从残缺属性中识别嵌套引用。
                    substitute(original)
                }
                cursor = end.offset; continue
            }
            if !htmlScope.containsHTML, Self.needsCJKClosingBoundary(characters, at: cursor) {
                // CommonMark 把“。**企业”判为非闭合。临时字母只改变边界分类，
                // Foundation 仍负责配对、嵌套与属性；恢复后不留下任何额外字符。
                substitute(String(character)); cursor += 1; continue
            }
            output.append(character); cursor += 1
        }
        markdown = output
        endingScope = htmlScope
        inlineImageRanges = imageRanges
        replacements = substitutions
    }

    func restore(_ value: inout AttributedString) {
        for replacement in replacements {
            guard let range = value.range(of: replacement.marker) else { continue }
            let attributes = value[range].runs.first?.attributes ?? AttributeContainer()
            var text = AttributedString(replacement.text, attributes: attributes)
            if let link = replacement.link { text.link = link }
            value.replaceSubrange(range, with: text)
        }
    }

    private static func hasPrefix(_ value: String, _ characters: [Character], at index: Int) -> Bool {
        let prefix = Array(value)
        return index + prefix.count <= characters.count && characters[index..<index + prefix.count].elementsEqual(prefix)
    }

    private static func codeEnd(_ characters: [Character], from start: Int) -> Int? {
        var cursor = start
        while cursor < characters.count && characters[cursor] == "`" { cursor += 1 }
        let count = cursor - start
        while cursor < characters.count {
            guard characters[cursor] == "`" else { cursor += 1; continue }
            let opening = cursor
            while cursor < characters.count && characters[cursor] == "`" { cursor += 1 }
            if cursor - opening == count { return cursor }
        }
        return nil
    }

    private static func linkEnd(_ characters: [Character], from start: Int) -> (end: Int, labelEnd: Int)? {
        var cursor = start + 1, depth = 1
        while cursor < characters.count {
            if characters[cursor] == "\\" { cursor += 2; continue }
            if characters[cursor] == "`", let end = codeEnd(characters, from: cursor) { cursor = end; continue }
            if characters[cursor] == "[" { depth += 1 }
            if characters[cursor] == "]" { depth -= 1; if depth == 0 { break } }
            cursor += 1
        }
        guard depth == 0, cursor + 1 < characters.count else { return nil }
        let labelEnd = cursor
        cursor += 1
        let opening = characters[cursor]
        guard opening == "(" || opening == "[" else { return nil }
        let closing: Character = opening == "(" ? ")" : "]"
        depth = 1; cursor += 1
        while cursor < characters.count {
            if characters[cursor] == "\\" { cursor += 2; continue }
            if characters[cursor] == opening { depth += 1 }
            if characters[cursor] == closing { depth -= 1; if depth == 0 { return (cursor + 1, labelEnd) } }
            cursor += 1
        }
        return nil
    }

    private static func citationStart(_ characters: [Character], at start: Int) -> Int? {
        for prefix in ["::codex-file-citation{", ":codex-file-citation{"] where hasPrefix(prefix, characters, at: start) {
            return start + prefix.count
        }
        return nil
    }

    private static func citationEnd(_ characters: [Character], from start: Int) -> (offset: Int, complete: Bool) {
        var cursor = start, depth = 1
        var quote: Character?
        while cursor < characters.count {
            let character = characters[cursor]
            if character == "\n" || character == "\r" { break }
            if let active = quote {
                if character == active { quote = nil }
            } else if character == "\"" || character == "'" { quote = character }
            else if character == "{" { depth += 1 }
            else if character == "}" { depth -= 1; if depth == 0 { return (cursor + 1, true) } }
            cursor += 1
        }
        return (cursor, false)
    }

    private static func citationPath(_ source: String) -> String? {
        let characters = Array(source)
        var cursor = 0
        var path: String?
        func identifier(_ value: Character, first: Bool) -> Bool {
            value.isASCII && (value.isLetter || value == "_" || (!first && (value.isNumber || value == "-")))
        }
        while cursor < characters.count {
            while cursor < characters.count && characters[cursor].isWhitespace { cursor += 1 }
            if cursor == characters.count { break }
            guard identifier(characters[cursor], first: true) else { return nil }
            let start = cursor; cursor += 1
            while cursor < characters.count && identifier(characters[cursor], first: false) { cursor += 1 }
            let name = String(characters[start..<cursor])
            while cursor < characters.count && characters[cursor].isWhitespace { cursor += 1 }
            guard cursor < characters.count, characters[cursor] == "=" else { return nil }
            cursor += 1
            while cursor < characters.count && characters[cursor].isWhitespace { cursor += 1 }
            guard cursor < characters.count, characters[cursor] == "\"" || characters[cursor] == "'" else { return nil }
            let quote = characters[cursor]; cursor += 1
            let valueStart = cursor
            while cursor < characters.count && characters[cursor] != quote { cursor += 1 }
            guard cursor < characters.count else { return nil }
            if name == "path" {
                guard path == nil else { return nil }
                path = String(characters[valueStart..<cursor])
            }
            cursor += 1
            guard cursor == characters.count || characters[cursor].isWhitespace else { return nil }
        }
        return path
    }

    private static func fileURL(_ path: String) -> URL? {
        let roots = ["/Users/", "/home/", "/tmp/", "/private/", "/var/", "/opt/", "/workspace/", "/workspaces/", "/repo/", "/app/"]
        guard roots.contains(where: path.hasPrefix),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) }),
              !path.dropFirst().components(separatedBy: "/").contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }),
              path.range(of: #":\d+(?::\d+)?$"#, options: .regularExpression) == nil else { return nil }
        // 与 file.open 的既有绝对路径入口一致；编码所有路径段中的 URL 保留字符。
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'")
        let segments = path.components(separatedBy: "/").compactMap { $0.addingPercentEncoding(withAllowedCharacters: allowed) }
        let encoded = segments.joined(separator: "/")
        guard segments.count == path.components(separatedBy: "/").count,
              let url = URL(string: encoded), url.absoluteString.removingPercentEncoding == path else { return nil }
        return url
    }

    private static func needsCJKClosingBoundary(_ characters: [Character], at index: Int) -> Bool {
        guard !["*", "_", "`", "\\"].contains(characters[index]),
              characters[index].unicodeScalars.allSatisfy({ CharacterSet.punctuationCharacters.contains($0) }),
              index + 2 < characters.count, characters[index + 1] == "*", characters[index + 2] == "*" else { return false }
        var end = index + 3
        while end < characters.count && characters[end] == "*" { end += 1 }
        guard end < characters.count else { return false }
        return characters[end].unicodeScalars.contains { scalar in
            (0x3400...0x9FFF).contains(scalar.value) || (0x20000...0x3134F).contains(scalar.value) ||
                (0x3040...0x30FF).contains(scalar.value) || (0xAC00...0xD7AF).contains(scalar.value)
        }
    }
}
