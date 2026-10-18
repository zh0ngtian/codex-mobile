import SwiftUI

/// 侧栏搜索与设置共用同一套尺寸、材质和轮廓。
struct SidebarIconButton: View {
    let systemImage: String
    let title: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.title3.weight(.light))
                .frame(width: 22, height: 32)
                .foregroundStyle(AgentTheme.ink)
        }
        .modifier(AgentGlassButton(circular: true))
        .controlSize(.regular)
        .tint(AgentTheme.page)
        .clipShape(.circle)
        .overlay {
            Circle().strokeBorder(AgentTheme.ink.opacity(0.08), lineWidth: 0.5).allowsHitTesting(false)
        }
        .shadow(color: .black.opacity(0.02), radius: 2, y: 1)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}
