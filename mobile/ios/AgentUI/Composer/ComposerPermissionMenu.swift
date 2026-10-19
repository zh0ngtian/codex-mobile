import SwiftUI

struct ComposerPermissionMenu: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences

    var body: some View {
        let context = session.nativeSnapshot.contextId
        let mode = session.composer.configuration.permission
        PermissionOptionsMenu(accent: preferences.accent, options: (session.nativeSnapshot.permissions ?? []).map { option in
            let optionMode = session.permissionMode(option.value)
            return PermissionMenuOption(id: option.id, value: option.value, title: title(optionMode), detail: detail(optionMode), symbol: optionMode.symbol)
        }, context: context, mode: mode, title: title(mode),
            menuTitle: preferences.text("权限模式", "Permission profile"),
            enabled: session.composerCanEdit && session.historyEdit == nil && !session.sidebarVisible,
            choose: { session.chooseMenuPermission($0, context: context) })
            .equatable()
    }
    private func title(_ mode: ApprovalMode) -> String {
        switch mode {
        case .ask: preferences.text("默认权限", "Default permissions")
        case .automatic: preferences.text("自动审核", "Automatic review")
        case .readOnly: preferences.text("只读", "Read only")
        case .fullAccess: preferences.text("完全访问权限", "Full access")
        case .custom: preferences.text("自定义", "Custom")
        }
    }
    private func detail(_ mode: ApprovalMode) -> String {
        switch mode {
        case .ask: preferences.text("按需请求你的批准", "Ask for approval when required")
        case .automatic: preferences.text("自动审查提权请求", "Automatically review elevated requests")
        case .readOnly: preferences.text("修改或执行需要批准", "Changes or execution require approval")
        case .fullAccess: preferences.text("完全访问计算机且不请求审批", "Full computer access without approval")
        case .custom: preferences.text("使用设备中的配置", "Uses the device's configuration")
        }
    }
}

struct PermissionMenuOption: Identifiable, Equatable {
    let id: String
    let value: String
    let title: String
    let detail: String
    let symbol: String
}

private struct PermissionOptionsMenu: View, Equatable {
    let accent: AgentAccent
    let options: [PermissionMenuOption]
    let context: String?
    let mode: ApprovalMode
    let title: String
    let menuTitle: String
    let enabled: Bool
    let choose: (String) -> Void

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.accent == rhs.accent && lhs.options == rhs.options && lhs.context == rhs.context && lhs.mode == rhs.mode &&
        lhs.title == rhs.title && lhs.menuTitle == rhs.menuTitle && lhs.enabled == rhs.enabled
    }
    var body: some View {
        NativePermissionMenuButton(tint: accent.color, options: options, context: context, mode: mode, title: title,
            menuTitle: menuTitle, enabled: enabled, choose: choose)
            .frame(width: 34, height: 44)
            .background { Capsule().fill(ComposerControlSurface.fill).frame(width: 34, height: 34) }
    }
}
