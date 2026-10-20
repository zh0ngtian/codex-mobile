import Foundation

enum QueueState: String, Codable, CaseIterable, Sendable {
    case queued, sending, failed, uncertain, guiding
    var blocksFollowing: Bool { self == .failed || self == .uncertain }
}
