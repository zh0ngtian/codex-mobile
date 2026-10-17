import Foundation

extension OutputItem {
    var previewSymbol: String {
        switch kind {
        case .text: "doc.text"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .markdown: "text.document"
        case .html: "globe"
        case .mermaid: "point.3.connected.trianglepath.dotted"
        case .image: "photo"
        case .video: "play.rectangle"
        case .binary: "doc.zipper"
        case .web: "link"
        }
    }
}
