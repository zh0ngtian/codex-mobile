import SwiftUI

struct DeviceManagerScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var addPresented: Bool
    @State private var editMode = EditMode.inactive

    init(openAddInitially: Bool = false) {
        _addPresented = State(initialValue: openAddInitially)
    }

    var body: some View {
        List {
            if session.devices.isEmpty {
                NoDevicesView(addDevice: showAdd)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(session.devices) { device in
                        DeviceManagerRow(device: device, isReordering: editMode == .active)
                    }
                    .onMove(perform: move)
                } header: {
                    Text(preferences.text("已添加 \(session.devices.count) 台设备", "\(session.devices.count) devices added"))
                } footer: {
                    Text(preferences.text("点击设备编辑连接。排序会同步到设备菜单。", "Tap a device to edit its connection. The device menu uses this order."))
                }
                Section {
                    Button(preferences.text("添加设备", "Add device"), systemImage: "plus", action: showAdd)
                        .accessibilityIdentifier("devices.add")
                }
            }
        }
        .environment(\.editMode, $editMode)
        .navigationTitle(preferences.text("设备", "Devices"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if session.devices.count > 1 {
                    Button(editMode == .active ? preferences.text("完成", "Done") : preferences.text("排序", "Reorder"), action: toggleReordering)
                }
            }
            SettingsCloseButton()
        }
        .navigationDestination(isPresented: $addPresented) { DeviceConnectionForm() }
        .navigationDestination(for: DeviceFormRoute.self) { route in
            switch route {
            case .add: DeviceConnectionForm()
            case .edit(let id): DeviceConnectionForm(deviceID: id)
            }
        }
        .task { session.openSettingsPage("devices") }
        .tint(AgentTheme.ink)
    }

    private func showAdd() { addPresented = true }
    private func toggleReordering() { editMode = editMode == .active ? .inactive : .active }

    private func move(from offsets: IndexSet, to destination: Int) {
        var orderedIDs = session.devices.map(\.id)
        orderedIDs.move(fromOffsets: offsets, toOffset: destination)
        session.reorderDevices(orderedIDs)
    }
}
