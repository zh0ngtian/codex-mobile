import Foundation

struct NotificationTarget: Codable, Equatable, Sendable {
    var deviceID: UUID
    var conversationID: UUID
}
