import SwiftUI

struct PermissionProfileSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                ForEach(session.currentCapabilities.permissions) { mode in
                    Button { select(mode) } label: {
                        HStack(spacing: 14) {
                            Image(systemName: mode.symbol).frame(width: 25).foregroundStyle(mode == .fullAccess ? .orange : AgentTheme.ink)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(title(mode)).font(.headline)
                                Text(detail(mode)).font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if session.composer.configuration.permission == mode { Image(systemName: "checkmark").bold() }
                        }
                        .padding(.vertical, 6)
                        .foregroundStyle(AgentTheme.ink)
                    }
                }
            }
            .navigationTitle(preferences.text("权限模式", "Permission profile"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(preferences.text("完成", "Done"), action: dismiss.callAsFunction) } }
        }
    }
    private func select(_ mode: ApprovalMode) {
        session.composer.configuration.permission = mode
        session.configurationDidChange()
        dismiss()
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
        case .custom: mode.detail
        }
    }
}
