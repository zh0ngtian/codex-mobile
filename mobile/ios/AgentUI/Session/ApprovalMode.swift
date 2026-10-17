import Foundation

enum ApprovalMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case ask = "Ask for approval"
    case automatic = "Approve for me"
    case readOnly = "Read only"
    case fullAccess = "Full access"
    case custom = "Custom (config.toml)"
    var id: String { rawValue }
    var symbol: String {
        switch self { case .ask: "hand.raised"; case .automatic: "checkmark.shield"; case .readOnly: "eye"; case .fullAccess: "exclamationmark.shield"; case .custom: "gearshape" }
    }
    var detail: String {
        switch self {
        case .ask: "Ask when an action needs approval"
        case .automatic: "Automatically review elevated requests"
        case .readOnly: "Changes and execution need approval"
        case .fullAccess: "Full computer access without approval"
        case .custom: "Uses the device's configuration"
        }
    }
}
