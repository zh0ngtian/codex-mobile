import Foundation

extension AppSession {
    func clearDeviceFormError() { deviceFormError = nil }
    /// 编辑时只在显式业务表单中读取完整凭证，不维护另一份凭证库。
    func prepareDeviceEditor(_ id: UUID?) async -> String? {
        deviceFormError = nil
        let previousDraft = nativeSnapshot.panel?.items.first(where: { $0.id == "gatewayUrl" })?.command.flatMap { string($0.params["draftId"]) }
        let expectedDraft = id.flatMap { rawDeviceIDs[$0] }
        let ok: Bool
        if let id, let raw = rawDeviceIDs[id] { ok = await request("device.edit", ["id": .string(raw)]) }
        else if id == nil { ok = await request("device.add") }
        else { return nil }
        guard ok else { deviceFormError = toast ?? "设备表单尚未就绪"; return nil }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        while clock.now < deadline, !Task.isCancelled {
            if let panel = nativeSnapshot.panel, panel.id == "devices", let name = panel.items.first(where: { $0.id == "name" }), let field = panel.items.first(where: { $0.id == "gatewayUrl" }), let draft = field.command.flatMap({ string($0.params["draftId"]) }), name.command.flatMap({ string($0.params["draftId"]) }) == draft, expectedDraft.map({ $0 == draft }) ?? (draft != previousDraft) {
                preparedDeviceID = id; preparedDeviceForm = true
                return field.value ?? ""
            }
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return nil }
        }
        deviceFormError = "设备表单尚未同步，请重试。"
        return nil
    }
    func saveDevice(id: UUID?, name: String, address: String) async -> Bool {
        guard !deviceTesting else { return false }
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let url = URLComponents(string: address), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host?.isEmpty == false, url.queryItems?.contains(where: { $0.name == "token" && $0.value?.isEmpty == false }) == true else { deviceFormError = "请输入设备名称和带 token 的完整 HTTP(S) 网关地址。"; return false }
        deviceOperation += 1
        let operation = deviceOperation
        deviceTesting = true; defer { deviceTesting = false }
        if !preparedDeviceForm || preparedDeviceID != id || nativeSnapshot.panel?.items.contains(where: { $0.id == "gatewayUrl" }) != true { guard await prepareDeviceEditor(id) != nil else { return false } }
        guard operation == deviceOperation else { return false }
        for (fieldID, value) in [("name", title), ("gatewayUrl", address)] {
            guard let field = nativeSnapshot.panel?.items.first(where: { $0.id == fieldID }), let command = field.command else { deviceFormError = "设备表单已变化，输入已保留。"; return false }
            var params = command.params; params["value"] = .string(value)
            guard operation == deviceOperation, await request(command.name, params), operation == deviceOperation else { deviceFormError = toast; return false }
        }
        let ok = await request("device.save")
        if !ok { deviceFormError = toast ?? "连接或保存失败，输入已保留。" }
        return ok
    }
    func cancelDeviceTest() async -> Bool {
        deviceOperation += 1
        return await request("device.cancel", ["testOnly": .bool(true)])
    }
    func moveDevice(_ id: UUID, by offset: Int) {
        guard let raw = rawDeviceIDs[id], offset != 0 else { return }
        Task { for _ in 0..<abs(offset) { guard await request("device.move", ["id": .string(raw), "direction": .number(offset < 0 ? -1 : 1)]) else { return } } }
    }
    func reorderDevices(_ orderedIDs: [UUID]) {
        guard orderedIDs.count == devices.count, Set(orderedIDs) == Set(devices.map(\.id)) else { return }
        Task {
            for (target, id) in orderedIDs.enumerated() {
                guard let raw = rawDeviceIDs[id], let current = devices.firstIndex(where: { $0.id == id }) else { return }
                for _ in 0..<abs(current - target) {
                    guard await request("device.move", ["id": .string(raw), "direction": .number(current > target ? -1 : 1)]) else { return }
                }
            }
        }
    }
    @discardableResult func setDeviceEnabled(_ id: UUID, enabled: Bool, discardQueue: Bool = false) -> Bool {
        guard let target = device(id), target.enabled != enabled, let raw = rawDeviceIDs[id] else { return false }
        fire("device.toggle", ["id": .string(raw), "confirmed": .bool(discardQueue)])
        return true
    }
    @discardableResult func removeDevice(_ id: UUID, confirmed: Bool = false) -> Bool {
        guard let raw = rawDeviceIDs[id] else { return false }
        fire("device.remove", ["id": .string(raw), "confirmed": .bool(confirmed)])
        return true
    }
    func reconnectAll() async { _ = await request("navigation.refresh") }
    func reconnectConversation(_ id: UUID) async { guard selectedConversationID == id else { open(id); return }; _ = await request("thread.retry") }
    func routeNotification(deviceID: UUID, conversationID: UUID) async { open(conversationID) }
    func handleURL(_ url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), let thread = parts.queryItems?.first(where: { $0.name == "thread" })?.value, let backend = parts.queryItems?.first(where: { $0.name == "device" })?.value else { return }
        fire("thread.open", ["backendId": .string(backend), "threadId": .string(thread)])
    }
}
