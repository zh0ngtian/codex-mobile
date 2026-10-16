import SwiftUI

struct NativeComposerConfigurationView: View {
    let store: NativeUIStore
    let contextID: String?

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                ForEach(store.snapshot.permissions ?? []) { option in
                    let context = contextID
                    Button { store.chooseComposerOption("permission.select", value: option.value, contextID: context) } label: {
                        Label(option.title, systemImage: NativeComposerSymbols.permissionSymbol(option.value))
                    }
                    .accessibilityHint(option.subtitle ?? "")
                }
            } label: {
                Label(store.label("权限", "Permissions"), systemImage: "exclamationmark.shield")
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
            }
            .menuOrder(.fixed)
            .foregroundStyle(Color.orange)
            .accessibilityValue(store.snapshot.permission ?? "")
            .accessibilityIdentifier("native-permission-menu")
            Menu {
                ForEach(store.snapshot.speeds ?? []) { option in
                    let context = contextID
                    Button { store.chooseComposerOption("speed.select", value: option.value, contextID: context) } label: {
                        Text(option.title)
                    }
                }
            } label: {
                Label(store.label("速度", "Speed"), systemImage: NativeComposerSymbols.speedSymbol(store.snapshot.speedValue))
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
            }
            .menuOrder(.fixed)
            .accessibilityValue("\(store.snapshot.speed ?? "")，\(NativeComposerSymbols.isFastEnabled(store.snapshot.speedValue) ? store.label("Fast 已开启", "Fast On") : store.label("Fast 已关闭", "Fast Off"))")
            .accessibilityIdentifier("native-speed-menu")
            Menu {
                Section(store.label("模型", "Model")) {
                    ForEach(store.snapshot.models) { option in
                        let context = contextID
                        Button { store.chooseComposerOption("model.select", value: option.value, contextID: context) } label: {
                            Text(option.title)
                        }
                    }
                }
                Section(store.label("思考强度", "Reasoning Effort")) {
                    ForEach(store.snapshot.efforts) { option in
                        let context = contextID
                        Button { store.chooseComposerOption("effort.select", value: option.value, contextID: context) } label: {
                            Text(option.title)
                        }
                    }
                }
            } label: {
                Text(NativeComposerSymbols.modelTitle(model: store.snapshot.model, effort: store.snapshot.effort, smart: store.label("智能", "Smart")))
                    .foregroundStyle(.primary).lineLimit(1).truncationMode(.middle)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
            }
            .menuOrder(.fixed)
            .accessibilityHint(store.label("模型与思考强度", "Model and Reasoning Effort"))
            .accessibilityValue("\(store.snapshot.model) \(store.snapshot.effort)")
            .accessibilityIdentifier("native-model-menu")
        }.buttonStyle(.plain).disabled(!store.composerCanEdit || store.sidebarOpen)
    }
}
