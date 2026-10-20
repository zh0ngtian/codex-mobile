import SwiftUI

struct DeviceConnectionForm: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    let deviceID: UUID?
    @State private var name = ""
    @State private var address = ""
    @State private var initialized = false
    @State private var scannerPresented = false
    @State private var localError: String?
    @State private var saveTask: Task<Void, Never>?
    @State private var deleteConfirmationPresented = false
    @State private var cancellingTest = false

    init(deviceID: UUID? = nil) { self.deviceID = deviceID }

    var body: some View {
        Form {
            Section {
                TextField(preferences.text("设备名称", "Device name"), text: $name)
                    .textContentType(.nickname)
                    .submitLabel(.next)
                    .accessibilityIdentifier("device.name")
                TextField(preferences.text("完整网关地址", "Full gateway URL"), text: $address, axis: .vertical)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .lineLimit(3...7)
                    .privacySensitive()
                    .accessibilityIdentifier("device.address")
            } header: {
                Text(preferences.text("连接信息", "Connection details"))
            } footer: {
                Text(preferences.text("地址必须以 http:// 或 https:// 开头，并包含 token 查询参数。访问口令直接包含在地址中。", "Use an http:// or https:// URL with a token query parameter. The access token is part of the URL."))
            }
            .disabled(session.deviceTesting)
            Section {
                Button(preferences.text("扫码或识别照片", "Scan QR or read photo"), systemImage: "qrcode.viewfinder", action: showScanner)
                    .disabled(session.deviceTesting)
            } footer: {
                Text(preferences.text("识别后只填入地址，仍需点击“测试并保存”。", "Recognition fills the URL. Tap Test and Save to verify the gateway."))
            }
            Section {
                Button(action: testAndSave) {
                    HStack(spacing: 10) {
                        if session.deviceTesting { ProgressView() }
                        Text(session.deviceTesting ? preferences.text("正在连接测试…", "Testing connection…") : preferences.text("测试并保存", "Test and Save"))
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(session.deviceTesting || !initialized || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("device.testAndSave")
                if session.deviceTesting {
                    Button(preferences.text("取消测试", "Cancel test"), role: .cancel, action: cancelTest)
                        .disabled(cancellingTest)
                }
            } footer: {
                Text(preferences.text("将连接网关验证访问权限，成功后保存连接。失败时保留输入供你重试。", "The gateway connection and access are tested before saving. Your input is preserved if testing fails."))
            }
            if let localError {
                Section { Label(localError, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            } else if let error = session.deviceFormError {
                Section {
                    Label(preferences.text("连接未保存，请检查地址后重试。", "Connection not saved. Check the URL and try again."), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                    Text(preferences.runtimeText(error)).font(.body).foregroundStyle(.secondary)
                }
            }
            if let deviceID, session.device(deviceID) != nil {
                Section {
                    Button(preferences.text("删除设备", "Delete device"), systemImage: "trash", role: .destructive) {
                        deleteConfirmationPresented = true
                    }
                    .disabled(session.deviceTesting || saveTask != nil)
                    .accessibilityIdentifier("device.delete")
                }
            }
        }
        .navigationTitle(deviceID == nil ? preferences.text("添加设备", "Add device") : preferences.text("编辑设备", "Edit device"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(preferences.text("设备", "Devices"), systemImage: "chevron.left", action: cancel)
                    .accessibilityLabel(preferences.text("取消并返回设备列表", "Cancel and return to devices"))
            }
            SettingsCloseButton()
        }
        .interactiveDismissDisabled()
        .alert(preferences.text("删除设备「\(deviceTitle)」？", "Delete \(deviceTitle)?"), isPresented: $deleteConfirmationPresented) {
            Button(preferences.text("删除设备", "Delete device"), role: .destructive, action: deleteDevice)
            Button(preferences.text("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(preferences.text("将删除此设备在本机的连接配置，并停止其本地任务。已保存的草稿会保留。", "This removes the device connection from this phone and stops its local tasks. Saved drafts are kept."))
        }
        .sheet(isPresented: $scannerPresented) {
            DeviceQRCodeScanner(onAddress: useScannedAddress)
                .presentationDetents([.medium, .large])
                .interactiveDismissDisabled()
        }
        .task { await initialize() }
        .onChange(of: name, clearErrors)
        .onChange(of: address, clearErrors)
        .onDisappear(perform: cancelTest)
    }

    private var deviceTitle: String { deviceID.flatMap(session.device)?.name ?? name }

    private func initialize() async {
        guard !initialized else { return }
        if let deviceID, let device = session.device(deviceID) {
            name = device.name
        }
        guard let editableAddress = await session.prepareDeviceEditor(deviceID) else {
            localError = preferences.text("无法读取设备连接，请返回后重试。", "Could not read the device connection. Go back and try again.")
            return
        }
        address = editableAddress
        session.clearDeviceFormError()
        initialized = true
    }

    private func showScanner() { scannerPresented = true }
    private func useScannedAddress(_ value: String) { address = value }

    private func clearErrors() {
        localError = nil
        session.clearDeviceFormError()
    }

    private func testAndSave() {
        guard !session.deviceTesting, saveTask == nil else { return }
        clearErrors()
        if let deviceID, session.device(deviceID) == nil {
            localError = preferences.text("此设备已被移除，请返回设备列表。", "This device has been removed. Return to the device list.")
            return
        }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, DeviceGatewayAddress.validated(trimmedAddress) != nil else {
            localError = preferences.text("请输入设备名称和包含非空 token 参数的完整 HTTP(S) 地址。", "Enter a device name and a full HTTP(S) URL with a nonempty token parameter.")
            return
        }
        saveTask = Task {
            let saved = await session.saveDevice(id: deviceID, name: trimmedName, address: trimmedAddress)
            guard !Task.isCancelled else { return }
            saveTask = nil
            if saved { dismiss() }
        }
    }

    private func cancelTest() {
        guard session.deviceTesting, !cancellingTest else { return }
        cancellingTest = true
        Task {
            if await session.cancelDeviceTest() {
                saveTask?.cancel()
                saveTask = nil
            }
            cancellingTest = false
        }
    }

    private func deleteDevice() {
        guard let deviceID, session.device(deviceID) != nil else { return }
        cancelTest()
        if session.removeDevice(deviceID, confirmed: true) {
            session.clearDeviceFormError()
            dismiss()
        }
    }

    private func cancel() {
        guard !cancellingTest else { return }
        if session.deviceTesting {
            cancellingTest = true
            Task {
                if await session.cancelDeviceTest() {
                    saveTask?.cancel()
                    saveTask = nil
                    guard await session.request("device.cancel") else { cancellingTest = false; return }
                    session.clearDeviceFormError()
                    dismiss()
                }
                cancellingTest = false
            }
        } else {
            cancellingTest = true
            Task {
                if await session.request("device.cancel") {
                    session.clearDeviceFormError()
                    dismiss()
                }
                cancellingTest = false
            }
        }
    }
}
