import SwiftUI

struct NativeSettingsGroupView<Content: View>: View {
    let title: String
    var scale: Double = 1
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption))
                .foregroundStyle(.secondary).frame(minHeight: 20, alignment: .leading)
                .padding(.horizontal, 15)
            VStack(spacing: 0) { content }
                .background(NativePalette.settingsCard, in: .rect(cornerRadius: 23))
        }
    }
}
