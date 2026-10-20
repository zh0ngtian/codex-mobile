import SwiftUI

struct NativeSettingsFieldView: View {
    let item: NativePanelItem
    let store: NativeUIStore
    let scope: NativeFieldScope
    var placeholder = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(item.title ?? "")
                .modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption))
                .foregroundStyle(.secondary).frame(minHeight: 20, alignment: .leading).padding(.horizontal, 15)
            Group {
                if item.kind == "secureField" {
                    SecureField(item.title ?? "", text: textBinding, prompt: Text(placeholder))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } else {
                    TextField(item.title ?? "", text: textBinding, prompt: Text(placeholder))
                }
            }
            .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale))
            .padding(.horizontal, 16).padding(.vertical, 17).frame(minHeight: 54)
            .background(NativePalette.settingsCard, in: .rect(cornerRadius: 18))
            .disabled(item.disabled == true || item.command == nil)
            .accessibilityIdentifier("native-field-\(item.id)")
        }
    }

    // 沿用共享 store 的作用域缓存与字段修订号，避免切页或异步 ACK 覆盖新输入。
    private var textBinding: Binding<String> {
        Binding(get: { store.fieldValue(item, scope: scope) }, set: { value in
            store.setFieldValue(value, item: item, scope: scope)
            store.sendFieldEdit(item, scope: scope, values: ["value": .string(value)])
        })
    }
}
