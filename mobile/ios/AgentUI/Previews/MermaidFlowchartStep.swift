import SwiftUI

struct MermaidFlowchartStep: View {
    @Environment(AppPreferences.self) private var preferences
    let label: String
    let isFirst: Bool
    let isHorizontal: Bool

    var body: some View {
        let layout = isHorizontal ? AnyLayout(HStackLayout(spacing: 12)) : AnyLayout(VStackLayout(spacing: 12))
        layout {
            if !isFirst {
                Image(systemName: isHorizontal ? "arrow.right" : "arrow.down")
                    .font(.title3).foregroundStyle(.secondary)
                    .accessibilityLabel(preferences.text("然后", "Then"))
            }
            Text(label).font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
                .padding(.horizontal, 24).padding(.vertical, 18).frame(minWidth: 180)
                .background(.tint.opacity(0.07), in: .rect(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(.tint.opacity(0.35)) }
        }
    }
}
