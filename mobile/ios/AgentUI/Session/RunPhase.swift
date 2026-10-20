import Foundation

enum RunPhase: String, Codable, Sendable {
    case idle, running, waitingApproval, waitingAnswer
    var isBusy: Bool { self != .idle }
}
