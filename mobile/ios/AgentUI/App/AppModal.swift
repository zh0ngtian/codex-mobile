import Foundation

enum AppModal: Identifiable, Equatable {
    case settings
    case drafts
    case addDevice
    case approval(UUID)
    case question(UUID)
    case preview(OutputItem)
    case nativePanel(String)

    var id: String {
        switch self {
        case .settings: return "settings"
        case .drafts: return "drafts"
        case .addDevice: return "add-device"
        case .approval(let id): return "approval-\(id)"
        case .question(let id): return "question-\(id)"
        case .preview(let item): return "preview-\(item.id)"
        case .nativePanel(let id): return "native-panel-\(id)"
        }
    }

    var requiresExplicitDismissal: Bool {
        switch self {
        case .settings, .addDevice, .approval, .question: return true
        case .drafts, .preview, .nativePanel: return false
        }
    }
}
