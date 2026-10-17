import Foundation

struct ApprovalRequest: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var conversationID: UUID
    var reason: String
    var command: String?
    var directory: String?
    var host: String?
    var paths: [String] = []
    var decisions: [ApprovalDecision] = [.allowOnce, .allowSession, .deny, .cancelTurn]
    var submitting = false
    var error: String?
}
