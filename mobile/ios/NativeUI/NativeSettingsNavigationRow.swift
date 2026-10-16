import SwiftUI

struct NativeSettingsNavigationRow: View {
    let title: String
    let symbol: String
    var value = ""
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Image(systemName: symbol).frame(width: 20)
                Text(title)
                Spacer(minLength: 8)
                if !value.isEmpty { Text(value).font(.caption).foregroundStyle(.secondary) }
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }.padding(.horizontal, 15).frame(minHeight: 55).contentShape(.rect)
        }.buttonStyle(.plain).foregroundStyle(.primary).accessibilityLabel(title).accessibilityValue(value)
    }
}
