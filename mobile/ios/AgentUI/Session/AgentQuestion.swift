import Foundation

struct AgentQuestion: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var title: String
    var detail = ""
    var options: [QuestionOption] = []
    var allowsCustom = true
    var secret = false
}
