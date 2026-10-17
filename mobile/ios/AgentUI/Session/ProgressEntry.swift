import Foundation

struct ProgressEntry: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var text: String
    var createdAt = Date.now
    var outputs: [OutputItem]?
}
