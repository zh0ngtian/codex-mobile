import SwiftUI

struct InlineIconButton: View {
    let title: String
    let symbol: String
    var font: Font = .body
    var color: Color = AgentTheme.ink
    let action: () -> Void

    var body: some View {
        Button(title, systemImage: symbol, action: action)
            .labelStyle(.iconOnly)
            .font(font)
            .foregroundStyle(color)
            .frame(width: 44, height: 44)
            .buttonStyle(.plain)
    }
}
