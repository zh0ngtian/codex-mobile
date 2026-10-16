import SwiftUI

struct NativeSettingsActionButton: View {
    let item: NativePanelItem
    let store: NativeUIStore
    var primary = false
    var symbol: String? = nil

    var body: some View {
        Button(action: perform) {
            HStack(spacing: 8) {
                if let symbol { Image(systemName: symbol).font(.system(size: 19)).accessibilityHidden(true) }
                Text(item.title ?? "").multilineTextAlignment(.center)
            }
            .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale, weight: .semibold))
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 49)
            .foregroundStyle(primary ? NativePalette.settingsCard : NativePalette.systemLabel)
            .background(primary ? NativePalette.systemLabel : NativePalette.settingsCard, in: .rect(cornerRadius: 18))
            .contentShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(.plain).disabled(item.disabled == true || item.command == nil)
        .opacity(item.disabled == true ? 0.45 : 1)
        .accessibilityIdentifier("native-settings-action-\(item.id)")
    }

    private func perform() { store.perform(item.command) }
}
