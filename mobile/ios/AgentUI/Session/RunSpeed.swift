import Foundation

enum RunSpeed: String, CaseIterable, Codable, Identifiable, Sendable {
    case normal, fast
    var id: String { rawValue }
    var symbol: String { self == .fast ? "bolt.fill" : "bolt" }
}
