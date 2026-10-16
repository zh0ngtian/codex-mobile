import SwiftUI

struct NativeSettingsGroupView<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 15)
            VStack(spacing: 0) { content }
                .background(NativePalette.settingsCard, in: .rect(cornerRadius: 23))
        }
    }
}
