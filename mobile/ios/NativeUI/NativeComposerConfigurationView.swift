import SwiftUI

struct NativeComposerConfigurationView: View {
    let store: NativeUIStore
    let openAdjustment: (NativeComposerAdjustmentKind) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(store.label("权限", "Permissions"), systemImage: "exclamationmark.shield") { openAdjustment(.permission) }
                .labelStyle(.iconOnly).font(.system(size: 20)).frame(width: 44, height: 44)
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
                Label(store.label("速度", "Speed"), systemImage: "bolt.fill")
                    .labelStyle(.iconOnly).font(.system(size: 20)).frame(width: 44, height: 44)
            }
            .accessibilityValue(store.snapshot.speed ?? "")
            .accessibilityIdentifier("native-speed-menu")
            Button { openAdjustment(.model) } label: {
                HStack(spacing: 4) {
                    Text(store.snapshot.model).foregroundStyle(.primary).lineLimit(1)
                    Text(store.snapshot.effort).foregroundStyle(.secondary).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                }
                .modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
            }
            .accessibilityLabel(store.label("模型与思考强度", "Model and Reasoning Effort"))
            .accessibilityValue("\(store.snapshot.model) \(store.snapshot.effort)")
            .accessibilityIdentifier("native-model-menu")
        }.buttonStyle(.plain).disabled(!store.composerCanEdit)
    }
}
