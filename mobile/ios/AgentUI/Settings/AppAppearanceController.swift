import UIKit

@MainActor
enum AppAppearanceController {
    static func apply(_ appearance: AgentAppearance) {
        let style: UIUserInterfaceStyle = switch appearance {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
        // Window-level styling also resets already-presented sheets when returning to System.
        for scene in UIApplication.shared.connectedScenes {
            guard let scene = scene as? UIWindowScene else { continue }
            for window in scene.windows { window.overrideUserInterfaceStyle = style }
        }
    }
}
