import SwiftUI

struct InlineIconButton: View {
    let title: String
    let symbol: String
    var font: Font = .body
    var imageScale: Image.Scale = .medium
    var color: Color = AgentTheme.ink
    var width: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(font).imageScale(imageScale)
                .foregroundStyle(color).frame(width: width, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}
