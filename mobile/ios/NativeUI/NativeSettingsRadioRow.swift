import SwiftUI

struct NativeSettingsRadioRow: View {
    let item: NativePanelItem
    let option: NativeOption
    let store: NativeUIStore
    let scope: NativeFieldScope

    var body: some View {
        Button(action: choose) {
            HStack(spacing: 12) {
                Image(systemName: "bell").font(.system(size: 20)).frame(width: 20).accessibilityHidden(true)
                Text(option.title)
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark").font(.system(size: 16)).foregroundStyle(NativePalette.bubbleText)
                        .accessibilityHidden(true)
                }
            }
            .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale))
            .padding(.horizontal, 15).padding(.vertical, 14).frame(minHeight: 55).contentShape(.rect)
        }
        .buttonStyle(.plain).foregroundStyle(.primary).disabled(item.disabled == true || item.command == nil)
        .accessibilityLabel(option.title).accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("native-settings-choice-\(option.id)")
    }

    private var selected: Bool { store.fieldValue(item, scope: scope) == option.value }
    private func choose() {
        store.setFieldValue(option.value, item: item, scope: scope)
        store.sendFieldEdit(item, scope: scope, values: ["value": .string(option.value)])
    }
}
