import Foundation

struct QuestionAnswer: Codable, Equatable, Sendable {
    var optionID: UUID?
    var custom = false
    var text = ""
}
