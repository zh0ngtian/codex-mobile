import SwiftUI

struct NativeSettingsNotificationsView: View {
    let panel: NativePanel
    let store: NativeUIStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NativeSettingsDetailView(panel: panel, store: store, back: back) {
            if let push = item("push") {
                VStack(alignment: .leading, spacing: 8) {
                    NativeSettingsGroupView(title: push.title ?? store.label("推送方式", "Push Method"), scale: store.snapshot.fontScale) {
                        ForEach(push.options ?? []) { option in
                            NativeSettingsRadioRow(item: push, option: option, store: store, scope: .panel(panel.id))
                            if option.id != push.options?.last?.id {
                                Divider().padding(.leading, 48).padding(.trailing, 15)
                            }
                        }
                    }
                    if let hint = item("push-hint")?.text {
                        NativeSettingsFootnoteView(text: hint, scale: store.snapshot.fontScale)
                    }
                }
            }
            if let bark = item("bark-url") {
                NativeSettingsFieldView(item: bark, store: store, scope: .panel(panel.id), placeholder: "https://api.day.app/DeviceKey")
            }
            if let save = item("push-save") { NativeSettingsActionButton(item: save, store: store, primary: true) }
            ForEach(additionalItems) { item in
                NativePanelItemView(item: item, store: store, scope: .panel(panel.id))
                    .foregroundStyle(item.id == "push-failed" ? .red : .primary)
            }
        }
    }

    private func back() { dismiss() }
    private func item(_ id: String) -> NativePanelItem? { panel.items.first { $0.id == id } }
    private var additionalItems: [NativePanelItem] { panel.items.filter { !["push", "push-hint", "bark-url", "push-save"].contains($0.id) } }
}
