import SwiftUI

struct GlassIconButton: View {
    let title: String
    let symbol: String
    var size: CGFloat = 46
    let action: () -> Void

    var body: some View {
        Button(title, systemImage: symbol, action: action)
            .labelStyle(.iconOnly)
            .font(.title3)
            .foregroundStyle(AgentTheme.ink)
            .frame(width: size, height: size)
            .background(.regularMaterial, in: .circle)
            .overlay { Circle().strokeBorder(AgentTheme.line, lineWidth: 0.6) }
            .buttonStyle(.plain)
    }
}
