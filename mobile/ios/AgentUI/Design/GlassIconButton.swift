import SwiftUI

struct GlassIconButton: View {
    let title: String
    let symbol: String
    var size: CGFloat = 46
    let action: () -> Void

    var body: some View {
        Button(title, systemImage: symbol, action: action)
            .labelStyle(.iconOnly)
            .font(.body)
            .foregroundStyle(AgentTheme.ink)
            .modifier(AgentGlassButton(circular: true))
            .controlSize(.large)
    }
}
