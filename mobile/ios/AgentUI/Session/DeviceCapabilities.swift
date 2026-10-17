import Foundation

struct DeviceCapabilities: Codable, Equatable, Sendable {
    var models: [String] = []
    var effortLevels: [String] = []
    var supportsFast = false
    var permissions: [ApprovalMode] = []
    func levels(for model: String) -> [String] {
        effortLevels
    }
}
