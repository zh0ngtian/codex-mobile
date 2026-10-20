import Foundation

struct AttachmentItem: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var name: String
    var kind: AttachmentKind = .file
    var state: AttachmentState = .ready
    var data: Data?
    var assetName: String?
    var error: String?
    var remoteURL: String?
    var mimeType: String?
    var byteCount: Int?
}
