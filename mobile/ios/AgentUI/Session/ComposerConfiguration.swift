import Foundation

struct ComposerConfiguration: Codable, Equatable, Sendable {
    var model = ""
    var reasoning = 0.0
    var speed = RunSpeed.normal
    var permission = ApprovalMode.ask
}
