import Foundation

struct MermaidFlowchart: Equatable {
    let labels: [String]
    let isHorizontal: Bool

    static func parse(_ source: String) throws -> MermaidFlowchart {
        let lines = source.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("%%") }
        guard let header = lines.first,
              ["flowchart TD", "flowchart TB", "flowchart LR", "graph TD", "graph TB", "graph LR"].contains(header),
              lines.count > 1 else { throw PreviewParsingError.unsupportedMermaid }
        let expression = try NSRegularExpression(pattern: #"^([A-Za-z][A-Za-z0-9_]*)(?:\[([^\[\]]+)\])?\s*-->\s*([A-Za-z][A-Za-z0-9_]*)(?:\[([^\[\]]+)\])?$"#)
        var labels: [String: String] = [:]
        var next: [String: String] = [:]
        var incoming = Set<String>()
        var identifiers = Set<String>()
        for line in lines.dropFirst() {
            guard let match = expression.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else {
                throw PreviewParsingError.unsupportedMermaid
            }
            func capture(_ index: Int) -> String? {
                guard let range = Range(match.range(at: index), in: line) else { return nil }
                return String(line[range])
            }
            guard let from = capture(1), let to = capture(3), from != to,
                  next[from] == nil, !incoming.contains(to) else { throw PreviewParsingError.unsupportedMermaid }
            for (identifier, label) in [(from, capture(2)), (to, capture(4))] {
                if let label {
                    guard labels[identifier] == nil || labels[identifier] == label else {
                        throw PreviewParsingError.unsupportedMermaid
                    }
                    labels[identifier] = label
                }
                identifiers.insert(identifier)
            }
            next[from] = to
            incoming.insert(to)
        }
        let starts = identifiers.subtracting(incoming)
        guard starts.count == 1, let start = starts.first else { throw PreviewParsingError.unsupportedMermaid }
        var ordered: [String] = []
        var visited = Set<String>()
        var current: String? = start
        while let identifier = current {
            guard visited.insert(identifier).inserted else { throw PreviewParsingError.unsupportedMermaid }
            ordered.append(labels[identifier] ?? identifier)
            current = next[identifier]
        }
        guard visited == identifiers else { throw PreviewParsingError.unsupportedMermaid }
        return MermaidFlowchart(labels: ordered, isHorizontal: header.hasSuffix("LR"))
    }
}
