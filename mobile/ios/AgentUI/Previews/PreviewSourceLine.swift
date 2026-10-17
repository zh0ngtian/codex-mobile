import Foundation

struct PreviewSourceLine: Identifiable {
    let id: Int
    let text: String

    static func lines(from source: String) -> [PreviewSourceLine] {
        source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
            .enumerated().map { PreviewSourceLine(id: $0.offset + 1, text: $0.element) }
    }
}
