import SwiftUI

struct NativeIconButton: View {
    let title: String
    let symbol: String
    let identifier: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 21, weight: .regular))
                .frame(minWidth: 44, minHeight: 44)
                .background(NativePalette.controlFill, in: .circle)
                .background(.ultraThinMaterial, in: .circle)
                .overlay { Circle().stroke(.primary.opacity(0.12), lineWidth: 0.5) }
        }
        .buttonStyle(.plain).accessibilityLabel(title).accessibilityIdentifier(identifier)
    }
}
