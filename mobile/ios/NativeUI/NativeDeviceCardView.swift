import SwiftUI

struct NativeDeviceCardView: View {
    let item: NativePanelItem
    let store: NativeUIStore
    @State private var detailsOpen = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "laptopcomputer").font(.system(size: 23)).frame(width: 23).accessibilityHidden(true)
                Button(action: showDetails) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title ?? "")
                            .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 5) {
                            Circle().fill(connection?.value == "online" ? Color.green : Color.secondary.opacity(0.5))
                                .frame(width: 6, height: 6).accessibilityHidden(true)
                            Text(connection?.text ?? item.text ?? "")
                                .modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption))
                                .foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
                }
                .buttonStyle(.plain).foregroundStyle(.primary)
                .accessibilityLabel(item.title ?? "")
                .accessibilityValue(item.text ?? connection?.text ?? "")
                .accessibilityHint(store.label("查看网关地址、排队与审批信息", "View gateway address, queue, and approvals"))
                .accessibilityIdentifier("native-device-details-\(item.id)")
                .popover(isPresented: $detailsOpen) {
                    Text(item.text ?? connection?.text ?? "")
                        .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale))
                        .textSelection(.enabled).padding(20).frame(idealWidth: 290)
                        .presentationCompactAdaptation(.popover)
                }
                if let edit = action("edit") {
                    Button(edit.title ?? store.label("编辑", "Edit"), systemImage: "pencil", action: editDevice)
                        .labelStyle(.iconOnly).font(.system(size: 20)).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(.rect)
                        .buttonStyle(.plain).disabled(edit.disabled == true)
                        .accessibilityLabel("\(edit.title ?? store.label("编辑", "Edit")) \(item.title ?? "")")
                        .accessibilityIdentifier("native-device-edit-\(item.id)")
                }
            }
            .padding(.top, 17)
            if let error = item.children?.first(where: { $0.id == "\(item.id):error" })?.text {
                Text(error).foregroundStyle(.red).textSelection(.enabled)
                    .modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption))
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
            }
            Divider().padding(.top, 14)
            NativeDeviceActionsView(item: item, store: store).padding(.top, 4).padding(.bottom, 5)
        }
        .padding(.horizontal, 15)
        .background(NativePalette.settingsCard, in: .rect(cornerRadius: 23))
        .accessibilityIdentifier("native-device-card-\(item.id)")
    }

    private var connection: NativePanelItem? { item.children?.first { $0.id == "\(item.id):connection" } }
    private func action(_ suffix: String) -> NativePanelItem? { item.children?.first { $0.id == "\(item.id):\(suffix)" } }
    private func showDetails() { detailsOpen = true }
    private func editDevice() { store.perform(action("edit")?.command) }
}
