import Foundation

struct DraftRecord: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var composition: ComposerDraft
    var updatedAt = Date.now
}
