import Foundation

struct QuestionOption: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var title: String
    var detail: String
}
