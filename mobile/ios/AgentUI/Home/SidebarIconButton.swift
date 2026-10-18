import SwiftUI

enum SidebarControlMetrics { static let contentHeight: CGFloat = 31 }

/// 搜索按钮与省略号菜单复用相同的独立圆形玻璃表面。
struct SidebarIconButton: View {
    let systemImage: String
    let title: String
    let identifier: String
    let action: () -> Void
    var body: some View {
        Button(action: action) { SidebarIconLabel(systemImage: systemImage) }
            .modifier(SidebarIconAppearance())
            .accessibilityLabel(title).accessibilityIdentifier(identifier)
    }
}

struct SidebarIconLabel: View {
    let systemImage: String
    var body: some View {
        Image(systemName: systemImage)
            .font(.title3.weight(.light))
            .frame(width: 22, height: SidebarControlMetrics.contentHeight)
            .foregroundStyle(AgentTheme.ink)
    }
}

struct SidebarIconAppearance: ViewModifier {
    func body(content: Content) -> some View {
        content.modifier(AgentGlassButton(circular: true))
            .controlSize(.regular).tint(AgentTheme.page).clipShape(.circle)
            .overlay { Circle().strokeBorder(AgentTheme.ink.opacity(0.08), lineWidth: 0.5).allowsHitTesting(false) }
            .shadow(color: .black.opacity(0.02), radius: 2, y: 1)
    }
}
