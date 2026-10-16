import SwiftUI

struct NativeModelOptionsView: View {
    let store: NativeUIStore
    let adjustment: NativeComposerAdjustment
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(store.label("模型与思考强度", "Model and Reasoning Effort"))
                    .modifier(NativeScaledFont(size: 19, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.primary)
                Spacer(minLength: 0)
                Button(store.label("关闭", "Close"), systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly).font(.body).foregroundStyle(Color.secondary)
                    .frame(width: 44, height: 44).contentShape(.rect)
                    .background { Circle().fill(NativePalette.settingsCard).frame(width: 34, height: 34) }
                    .buttonStyle(.plain)
            }.padding(.leading, 22).padding(.trailing, 12).padding(.top, 12).padding(.bottom, 14)
            ScrollView {
                VStack(spacing: 20) {
                    NativeComposerOptionGroup(title: store.label("模型", "Model"), options: store.snapshot.models, selected: store.snapshot.modelValue, scale: store.snapshot.fontScale) { value in
                        store.chooseComposerOption("model.select", value: value, contextID: adjustment.contextID)
                    }
                    NativeComposerOptionGroup(title: store.label("思考强度", "Reasoning Effort"), options: store.snapshot.efforts, selected: store.snapshot.effortValue, scale: store.snapshot.fontScale) { value in
                        store.chooseComposerOption("effort.select", value: value, contextID: adjustment.contextID)
                    }
                }.padding(.horizontal, 16).padding(.bottom, 12)
            }.scrollIndicators(.hidden).disabled(!store.composerCanEdit || adjustment.contextID != store.snapshot.contextId)
            Button(store.label("完成", "Done")) { dismiss() }
                .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(NativePalette.canvas).background(NativePalette.systemLabel, in: .rect(cornerRadius: 19))
                .buttonStyle(.plain).padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 16)
        }
        .background(NativePalette.settings)
        .presentationDetents([.fraction(0.74), .large]).presentationDragIndicator(.visible)
        .accessibilityIdentifier("native-model-options")
    }
}
