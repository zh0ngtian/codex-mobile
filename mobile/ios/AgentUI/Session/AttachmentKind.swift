import Foundation

enum AttachmentKind: String, Codable, CaseIterable, Sendable {
    case image, file, audio, video
    var symbol: String {
        switch self { case .image: "photo"; case .file: "doc"; case .audio: "waveform"; case .video: "video" }
    }
}
