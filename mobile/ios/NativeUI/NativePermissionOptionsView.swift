import SwiftUI

struct NativePermissionOptionsView: View {
    let store: NativeUIStore
    let adjustment: NativeComposerAdjustment
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Text(store.label("Codex 可以执行哪些操作？", "What can Codex do?"))
                    .modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.primary)
                Text(store.label("按本次对话选择访问范围", "Choose access for this conversation"))
                    .modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption))
                    .foregroundStyle(Color.secondary)
            }
            .frame(maxWidth: .infinity).padding(.horizontal, 44).padding(.top, 20).padding(.bottom, 16)
            .overlay(alignment: .topTrailing) {
                Button(store.label("关闭", "Close"), systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly).font(.body).foregroundStyle(Color.secondary)
                    .frame(width: 44, height: 44).contentShape(.rect).padding(.top, 6).padding(.trailing, 8)
                    .buttonStyle(.plain)
            }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(store.snapshot.permissions ?? []) { option in
                        VStack(spacing: 0) {
                            NativePermissionOptionView(option: option, selected: option.value == store.snapshot.permissionValue, scale: store.snapshot.fontScale) {
                                store.chooseComposerOption("permission.select", value: option.value, contextID: adjustment.contextID)
                                dismiss()
                            }
                            if option.id != store.snapshot.permissions?.last?.id { Divider().padding(.leading, 32) }
                        }
                    }
                }.padding(.horizontal, 13).background(NativePalette.permissionCard, in: .rect(cornerRadius: 25))
                    .padding(.horizontal, 20).padding(.bottom, 16)
            }.scrollIndicators(.hidden).disabled(!store.composerCanEdit || adjustment.contextID != store.snapshot.contextId)
        }
        .background(NativePalette.settings)
        // 固定 detent 为内容高度；系统另外添加底部安全区，普通字号总高约 348pt。
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(314), .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("native-permission-options")
    }
}
