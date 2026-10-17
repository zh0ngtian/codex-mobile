import Foundation

struct QuestionRequest: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var conversationID: UUID
    var questions: [AgentQuestion]
    var answers: [UUID: QuestionAnswer] = [:]
    var submitting = false
    var error: String?
    var isValid: Bool {
        questions.allSatisfy { question in
            guard let answer = answers[question.id] else { return false }
            if question.options.isEmpty || answer.custom {
                return (question.options.isEmpty || question.allowsCustom) && !answer.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            return question.options.contains { $0.id == answer.optionID }
        }
    }
}
