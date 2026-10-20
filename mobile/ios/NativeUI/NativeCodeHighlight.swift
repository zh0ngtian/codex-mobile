import SwiftUI

/// 保留原始文本与复制内容，只给字符串和差异行增加视觉区分。
enum NativeCodeHighlight {
    static func text(_ source: String, language: String) -> AttributedString {
        var result = AttributedString(source)
        let pattern = language.lowercased() == "diff" ? "(?m)^[+-].*$" : #""(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return result }
        for match in expression.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
            guard let range = Range(match.range, in: source),
                  let start = AttributedString.Index(range.lowerBound, within: result),
                  let end = AttributedString.Index(range.upperBound, within: result) else { continue }
            let addition = language.lowercased() == "diff" && source[range].hasPrefix("+")
            result[start..<end].foregroundColor = addition ? .green : .red
        }
        return result
    }
}
