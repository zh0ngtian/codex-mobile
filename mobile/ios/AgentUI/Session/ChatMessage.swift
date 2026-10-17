import Foundation

struct ChatMessage: Identifiable, Codable, Equatable, Hashable, Sendable {
    var id = UUID()
    var isUser: Bool
    var text: String
    var kind = "plain"
    var duration = ""
    var timestamp = ""
    var createdAt = Date.now
    var attachments: [AttachmentItem] = []
    var commentary: [ProgressEntry] = []
    var outputs: [OutputItem] = []
    var turnID: UUID?
    var timestampLabel: String { timestamp.isEmpty ? "" : MessageTimeFormatting.string(from: createdAt) }
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.isUser == rhs.isUser && lhs.text == rhs.text && lhs.attachments == rhs.attachments && lhs.commentary == rhs.commentary && lhs.outputs == rhs.outputs && lhs.kind == rhs.kind && lhs.createdAt == rhs.createdAt && lhs.duration == rhs.duration && lhs.timestamp == rhs.timestamp && lhs.turnID == rhs.turnID
    }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
