import Foundation

extension ApprovalDecision {
    @MainActor func title(using preferences: AppPreferences) -> String {
        switch self {
        case .allowOnce: preferences.text("允许这一次", "Allow once")
        case .allowSession: preferences.text("本会话允许", "Allow for this conversation")
        case .deny: preferences.text("拒绝", "Deny")
        case .cancelTurn: preferences.text("取消本轮", "Cancel this turn")
        case .rememberPrefix: preferences.text("允许并记住命令前缀", "Allow and remember command prefix")
        case .rememberHost: preferences.text("允许并记住主机规则", "Allow and remember host rule")
        case .blockHost: preferences.text("拒绝并屏蔽此主机", "Deny and block this host")
        }
    }

    var symbol: String {
        switch self {
        case .allowOnce: "checkmark"
        case .allowSession: "checkmark.shield"
        case .deny: "hand.raised"
        case .cancelTurn: "stop"
        case .rememberPrefix: "terminal"
        case .rememberHost: "network.badge.shield.half.filled"
        case .blockHost: "network.slash"
        }
    }

    var isDestructive: Bool { self == .deny || self == .cancelTurn || self == .blockHost }
}
