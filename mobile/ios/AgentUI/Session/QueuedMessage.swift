import Foundation

struct QueuedMessage: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var text: String
    var attachments: [AttachmentItem] = []
    var mentions: [String] = []
    var configuration: ComposerConfiguration
    var configurationKnown = true
    var state: QueueState = .queued
    var isLocalRecovery = false
    var error: String?
    var savedDraftID: UUID?
    var retryCount: Int?
}
