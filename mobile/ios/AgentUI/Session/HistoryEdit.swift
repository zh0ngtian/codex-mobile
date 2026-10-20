import Foundation

struct HistoryEdit: Equatable, Sendable {
    var conversationID: UUID
    var messageID: UUID
    var text: String
}
