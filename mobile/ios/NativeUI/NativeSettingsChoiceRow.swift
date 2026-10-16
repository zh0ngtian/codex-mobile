import SwiftUI

struct NativeSettingsChoiceRow: View {
    let title: String
    let symbol: String
    let item: NativePanelItem?
    let store: NativeUIStore

    var body: some View {
        Menu {
            ForEach(item?.options ?? []) { option in
                Button { choose(option.value) } label: {
                    if option.value == item?.value { Label(option.title, systemImage: "checkmark") }
                    else { Text(option.title) }
                }
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).frame(width: 20)
                Text(title)
                Spacer(minLength: 8)
                Text(selectedTitle).font(.caption).foregroundStyle(.secondary)
                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.tertiary)
            }.padding(.horizontal, 15).frame(minHeight: 55).contentShape(.rect)
        }
        .buttonStyle(.plain).foregroundStyle(.primary)
        .disabled(item?.command == nil || item?.disabled == true)
        .accessibilityLabel(title)
        .accessibilityValue(selectedTitle)
    }

    private var selectedTitle: String { item?.options?.first { $0.value == item?.value }?.title ?? "" }
    private func choose(_ value: String) {
        guard let command = item?.command else { return }
        var params = command.params
        params["value"] = .string(value)
        store.command(command.name, params)
    }
}
