import Foundation

struct ProgressEntry: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var text: String
    var createdAt: Date? = nil
    var outputs: [OutputItem]?
    var isPreviousReply: Bool? = nil
    var timestampLabel: String {
        guard let createdAt else { return "" }
        return MessageTimeFormatting.string(from: createdAt)
    }
}
