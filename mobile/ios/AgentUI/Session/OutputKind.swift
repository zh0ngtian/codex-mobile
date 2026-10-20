import Foundation

enum OutputKind: String, Codable, CaseIterable, Sendable {
    case text, code, markdown, html, mermaid, image, video, binary, web
}
