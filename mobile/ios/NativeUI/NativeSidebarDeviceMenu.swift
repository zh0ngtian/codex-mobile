import SwiftUI

struct NativeSidebarDeviceMenu: View {
    let store: NativeUIStore
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(store.label("连接的设备", "Connected Devices"))
                    .modifier(NativeScaledFont(size: 10, scale: store.snapshot.fontScale, relativeTo: .caption2))
                    .foregroundStyle(NativePalette.secondary)
                Spacer(minLength: 0)
                Menu {
                    Button(store.label("置顶", "Pinned")) { filter("favorites") }
                    Button(store.label("项目", "Projects")) { filter("projects") }
                    Button(store.label("会话", "Conversations")) { filter("sessions") }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.system(size: 13)).foregroundStyle(NativePalette.secondary)
                        .frame(width: 32, height: 32).contentShape(.rect)
                }
                .accessibilityLabel(store.label("筛选会话", "Filter Conversations"))
            }
            .padding(.leading, 12).padding(.trailing, 4)

            row(store.label("全部设备", "All Devices"), symbol: "laptopcomputer.and.iphone",
                selected: store.snapshot.listBackendId == "all") {
                selectBackend("all")
            }
            if store.navigationBackends.count > 4 {
                ScrollView {
                    backendRows
                }
                .frame(maxHeight: 176)
                .scrollIndicators(.hidden)
            } else {
                backendRows
            }

            Divider().padding(.horizontal, 5).padding(.vertical, 4)
            row(store.label("草稿", "Drafts"), symbol: "doc.text") {
                dismiss()
                store.command("drafts.open")
            }
            row(store.label("设置", "Settings"), symbol: "gearshape", identifier: "native-settings-open") {
                dismiss()
                store.settingsOpen = true
            }
            row(store.label("刷新", "Refresh"), symbol: "arrow.clockwise", identifier: "native-sidebar-refresh") {
                dismiss()
                store.command("navigation.refresh")
            }
        }
        .padding(6)
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(.regularMaterial)
                .overlay { RoundedRectangle(cornerRadius: 16).fill(NativePalette.settingsCard.opacity(0.80)) }
        }
        .overlay { RoundedRectangle(cornerRadius: 16).stroke(.primary.opacity(0.12), lineWidth: 0.5) }
        .shadow(color: .black.opacity(0.12), radius: 20, y: 8)
    }

    private var backendRows: some View {
        VStack(spacing: 0) {
            ForEach(store.navigationBackends) { backend in
                row(backend.title, symbol: "laptopcomputer", selected: store.snapshot.listBackendId == backend.id) {
                    selectBackend(backend.id)
                }
            }
        }
    }

    private func row(_ title: String, symbol: String, identifier: String? = nil,
                     selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 17)).frame(width: 19).accessibilityHidden(true)
                Text(title).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.primary).accessibilityHidden(true)
                }
            }
            .modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale, weight: .medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(identifier ?? "native-device-menu-row-\(selected ? "selected" : title)")
    }

    private func selectBackend(_ id: String) {
        dismiss()
        store.command("backend.select", ["id": .string(id)])
    }

    private func filter(_ value: String) {
        dismiss()
        store.command("navigation.filter", ["value": .string(value)])
    }
}
