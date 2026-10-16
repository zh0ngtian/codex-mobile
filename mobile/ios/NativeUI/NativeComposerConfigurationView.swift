import SwiftUI

struct NativeComposerConfigurationView: View {
    let store: NativeUIStore
    let openAdjustment: (NativeComposerAdjustmentKind) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(store.label("权限", "Permissions"), systemImage: "exclamationmark.shield") { openAdjustment(.permission) }
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
                .foregroundStyle(Color.orange)
                .accessibilityValue(store.snapshot.permission ?? "")
                .accessibilityIdentifier("native-permission-menu")
            Menu {
                ForEach(store.snapshot.speeds ?? []) { option in
                    let context = store.snapshot.contextId
                    Button { store.chooseComposerOption("speed.select", value: option.value, contextID: context) } label: {
                        if option.value == store.snapshot.speedValue { Label(option.title, systemImage: "checkmark") }
                        else { Text(option.title) }
                    }
                }
            } label: {
                Label(store.label("速度", "Speed"), systemImage: NativeComposerSymbols.speedSymbol(store.snapshot.speedValue))
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
            }
            .accessibilityValue("\(store.snapshot.speed ?? "")，\(store.snapshot.speedValue == "fast" ? store.label("Fast 已开启", "Fast On") : store.label("Fast 已关闭", "Fast Off"))")
            .accessibilityIdentifier("native-speed-menu")
            Menu {
                Section(store.label("模型", "Model")) {
                    ForEach(store.snapshot.models) { option in
                        let context = store.snapshot.contextId
                        Button { store.chooseComposerOption("model.select", value: option.value, contextID: context) } label: {
                            if option.value == store.snapshot.modelValue { Label(option.title, systemImage: "checkmark") }
                            else { Text(option.title) }
                        }
                    }
                }
                Section(store.label("思考强度", "Reasoning Effort")) {
                    ForEach(store.snapshot.efforts) { option in
                        let context = store.snapshot.contextId
                        Button { store.chooseComposerOption("effort.select", value: option.value, contextID: context) } label: {
                            if option.value == store.snapshot.effortValue { Label(option.title, systemImage: "checkmark") }
                            else { Text(option.title) }
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(store.snapshot.model).foregroundStyle(.primary).lineLimit(1)
                    Text(store.snapshot.effort).foregroundStyle(.secondary).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
            }
            .accessibilityLabel(store.label("模型与思考强度", "Model and Reasoning Effort"))
            .accessibilityValue("\(store.snapshot.model) \(store.snapshot.effort)")
            .accessibilityIdentifier("native-model-menu")
        }.buttonStyle(.plain).disabled(!store.composerCanEdit)
    }
}
