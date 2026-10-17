import Foundation

struct ComposerDraft: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var deviceID: UUID?
    var project: String?
    var text = ""
    var attachments: [AttachmentItem] = []
    var configuration = ComposerConfiguration()
    var savedDraftID: UUID?
    var hasContent: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty }
    var attachmentsReady: Bool { attachments.allSatisfy { $0.state == .ready } }
    var mentions: [String] {
        text.split(whereSeparator: \.isWhitespace).filter { $0.hasPrefix("@") }.map(String.init)
    }
}
