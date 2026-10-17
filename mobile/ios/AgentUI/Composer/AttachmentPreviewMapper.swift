import Foundation
import UniformTypeIdentifiers

enum AttachmentPreviewMapper {
    static func output(for item: AttachmentItem) -> OutputItem? {
        guard item.state == .ready, item.data != nil || item.remoteURL != nil || (item.kind == .image && item.assetName != nil) else { return nil }
        let kind: OutputKind
        switch item.kind {
        case .image: kind = .image
        case .audio, .video: kind = .video
        case .file: kind = fileKind(name: item.name)
        }
        return OutputItem(id: item.id, name: item.name, kind: kind, data: item.data, assetName: item.assetName, remoteURL: item.remoteURL)
    }

    private static func fileKind(name: String) -> OutputKind {
        let suffix = (name as NSString).pathExtension.lowercased()
        switch suffix {
        case "md", "markdown": return .markdown
        case "html", "htm": return .html
        case "mmd", "mermaid": return .mermaid
        case "swift", "js", "ts", "tsx", "jsx", "py", "rb", "sh", "json", "yml", "yaml", "css", "xml", "c", "h", "cpp", "rs", "go": return .code
        default:
            guard let type = UTType(filenameExtension: suffix) else { return .binary }
            return type.conforms(to: .text) ? .text : .binary
        }
    }
}
