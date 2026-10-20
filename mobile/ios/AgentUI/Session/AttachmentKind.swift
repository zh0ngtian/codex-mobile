import UniformTypeIdentifiers
import Foundation

enum AttachmentKind: String, Codable, CaseIterable, Sendable {
    case image, file, audio, video
    var symbol: String {
        switch self { case .image: "photo"; case .file: "doc"; case .audio: "waveform"; case .video: "video" }
    }
}

extension AttachmentKind {
    static func forFileName(_ name: String) -> AttachmentKind {
        guard let type = UTType(filenameExtension: (name as NSString).pathExtension) else { return .file }
        if type.conforms(to: .image) { return .image }
        if type.conforms(to: .movie) { return .video }
        if type.conforms(to: .audio) { return .audio }
        return .file
    }
}
