import Foundation

enum ApprovalDecision: String, Codable, CaseIterable, Identifiable, Sendable {
    case allowOnce, allowSession, deny, cancelTurn, rememberPrefix, rememberHost, blockHost
    var id: String { rawValue }
}
