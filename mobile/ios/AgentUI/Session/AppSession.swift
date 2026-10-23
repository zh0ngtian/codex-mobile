import Foundation
import Observation

/// AgentApp 只持有界面呈现；会话、草稿、设备和任务始终以现有业务桥快照为准。
@MainActor @Observable
final class AppSession {
    var devices: [BackendDevice] = []
    var conversations: [Conversation] = []
    var drafts: [DraftRecord] = []
    var approvals: [ApprovalRequest] = []
    var questions: [QuestionRequest] = []
    var accountQuotas: [String: AccountQuota] = [:]
    var selectedDeviceID: UUID?
    var selectedConversationID: UUID?
    var sidebarVisible = true {
        didSet {
            if !sidebarVisible { searchVisible = false; if !projecting { searchText = "" } }
            if !projecting { nativeStore?.sidebarIsOpen = sidebarVisible }
        }
    }
    var composer = ComposerDraft() {
        didSet {
            guard !projecting, oldValue.text != composer.text else { return }
            nativeStore?.composerText = composer.text
        }
    }
    var newEditor = ComposerDraft()
    var editors: [UUID: ComposerDraft] = [:]
    var activeApprovalID: UUID?
    var activeQuestionID: UUID?
    var previewItem: OutputItem?
    var settingsPresented = false
    var draftsPresented = false { didSet { if draftsPresented && !projecting { nativeStore?.command("drafts.open") } } }
    var toast: String?
    var lastErrorMessage: String?
    var errorNotices: [AppErrorNotice] = []
    var persistenceError: String?
    var draftReadError = false
    var deviceFormError: String?
    var deviceTesting = false
    var menuBusyID: UUID?
    var renameTargetID: UUID?
    var archiveTargetID: UUID?
    var inputFocused = false
    var inputModalPresented = false
    var referenceTarget: UUID?
    var referenceRequestRevision = 0
    var historyEdit: HistoryEdit?
    var pendingNotification: NotificationTarget?
    var searchText = "" { didSet { if !projecting { searchDidChange() } } }
    var searchVisible = false
    var expandedProjects: Set<String> = []
    var projectPageCounts: [String: Int] = [:]
    var projectErrors: Set<String> = []
    var loadingProjects: Set<String> = []
    var scopedProjects: [String] = []
    var navigationLoading = true
    var navigationError: String?
    var nativeSnapshot = NativeSnapshot()
    var submissionPending = false
    @ObservationIgnored var presentedAttachmentPanelID: String?
    @ObservationIgnored var nativeStore: NativeUIStore?
    @ObservationIgnored var projecting = false
    @ObservationIgnored var projectedErrors: [String: String] = [:]
    @ObservationIgnored var identifiers: [String: UUID] = [:]
    @ObservationIgnored var rawDeviceIDs: [UUID: String] = [:]
    @ObservationIgnored var rawThreadIDs: [UUID: (backend: String, thread: String)] = [:]
    @ObservationIgnored var rawMessageIDs: [UUID: String] = [:]
    @ObservationIgnored var rawAttachmentIDs: [UUID: String] = [:]
    @ObservationIgnored var rawQueueIDs: [UUID: String] = [:]
    @ObservationIgnored var rawDraftIDs: [UUID: String] = [:]
    @ObservationIgnored var projectGroups: [String: NativeGroup] = [:]
    @ObservationIgnored var navigationRetryCommand: NativeCommand?
    @ObservationIgnored var navigationIDs: Set<UUID> = []
    @ObservationIgnored var deviceOperation = 0
    @ObservationIgnored var deviceFieldRevision = 0
    @ObservationIgnored var preparedDeviceID: UUID?
    @ObservationIgnored var preparedDeviceForm = false
    @ObservationIgnored var projectMembers: [String: Set<UUID>] = [:]
    @ObservationIgnored var requestCommands: [UUID: [UUID: NativeCommand]] = [:]
    @ObservationIgnored var questionMemory: [UUID: QuestionRequest] = [:]
    @ObservationIgnored var questionBackends: [UUID: String] = [:]
    @ObservationIgnored var confirmedQuestionReplies: [UUID: String] = [:]
    @ObservationIgnored var answerSubmissionsInFlight: Set<UUID> = []
    @ObservationIgnored var postponedQuestionIDs: Set<UUID> = []
    @ObservationIgnored var reopenRequestIntent = false
    @ObservationIgnored var questionPanels: [UUID: NativePanel] = [:]
    @ObservationIgnored var silentCommands = Set<String>()
    @ObservationIgnored var pendingCommands: [String: (context: String?, continuation: CheckedContinuation<Bool, Never>)] = [:]
    @ObservationIgnored var commandTimeouts: [String: Task<Void, Never>] = [:]

    init() {}
    init(store: NativeUIStore) { nativeStore = store; receive(store.snapshot) }

    var nativePanel: NativePanel? { nativeSnapshot.panel }
    var selectedConversation: Conversation? { selectedConversationID.flatMap(conversation) }
    var currentDevice: BackendDevice? { (selectedConversation?.deviceID ?? composer.deviceID ?? selectedDeviceID).flatMap(device) }
    var currentCapabilities: DeviceCapabilities { currentDevice?.capabilities ?? DeviceCapabilities() }
    var visibleConversations: [Conversation] { conversations.filter { !$0.isArchived && (searchText.isEmpty || navigationIDs.contains($0.id)) && (selectedDeviceID == nil || $0.deviceID == selectedDeviceID) && device($0.deviceID)?.enabled == true } }
    var isBusy: Bool { nativeSnapshot.busy }
    var composerCanEdit: Bool { nativeStore?.composerCanEdit == true }
    var canReopenPendingRequests: Bool {
        nativeSnapshot.ready && nativeSnapshot.approvalCount > 0 && nativeStore?.awaitingNewConversation != true && nativeSnapshot.conversationActions?.contains { $0.command?.name == "approval.reopen" && $0.disabled != true } == true
    }
    var hasDeferredQuestion: Bool { canReopenPendingRequests && questionMemory.values.contains { $0.conversationID == selectedConversationID } }
    var canSubmit: Bool { !submissionPending && historyEdit == nil && nativeStore?.composerCanSend == true && composer.hasContent && composer.attachmentsReady }
    var canSaveDraft: Bool { !submissionPending && nativeStore?.composerCanEdit == true && selectedConversationID == nil && composer.hasContent && composer.attachmentsReady && !isBusy }
    var pendingOtherDevices: [BackendDevice] { devices.filter { $0.enabled && $0.id != selectedDeviceID && pendingCount(for: $0.id) > 0 } }
    var mentionOptions: [NativeOption] { nativeSnapshot.mentions ?? [] }
    var hasMoreConversations: Bool { projectGroups.values.contains { $0.actions?.contains { $0.command?.name == "project.more" } == true } }
    func device(_ id: UUID) -> BackendDevice? { devices.first { $0.id == id } }
    func conversation(_ id: UUID) -> Conversation? { conversations.first { $0.id == id } }
    func index(_ id: UUID) -> Int? { conversations.firstIndex { $0.id == id } }
    func approval(_ id: UUID) -> ApprovalRequest? { approvals.first { $0.id == id } }
    func question(_ id: UUID) -> QuestionRequest? { questions.first { $0.id == id } }
    func accountQuota(for deviceID: UUID?) -> AccountQuota? { (deviceID.flatMap(device) ?? currentDevice).flatMap { accountQuotas[$0.accountKey] } }
    func canInteract(_ id: UUID) -> Bool { selectedConversationID == id && nativeStore?.composerCanEdit == true && nativeSnapshot.connection == "online" }
    func pendingCount(for deviceID: UUID) -> Int {
        if let raw = rawDeviceIDs[deviceID], let count = nativeSnapshot.backends.first(where: { $0.id == raw })?.approvalCount { return max(0, count) }
        let ids = Set(conversations.filter { $0.deviceID == deviceID }.map(\.id))
        return approvals.filter { ids.contains($0.conversationID) }.count + questions.filter { ids.contains($0.conversationID) }.count
    }
    func search(_ query: String) -> [Conversation] { conversations.filter { $0.title.localizedStandardContains(query) || $0.project?.localizedStandardContains(query) == true } }
    func makeEditor(deviceID: UUID?, project: String? = nil) -> ComposerDraft { ComposerDraft(deviceID: deviceID, project: project) }
    func stashEditor() {} // 草稿已经由 NativeUIStore 的 revision 协议同步到共享 runtime。
    func rawConversationID(_ id: UUID) -> String? { rawThreadIDs[id]?.thread }
    func nativeMessage(_ id: UUID) -> NativeMessage? { rawMessageIDs[id].flatMap { raw in nativeSnapshot.messages.first { $0.id == raw } } }
    func stableID(_ key: String) -> UUID { if let id = identifiers[key] { return id }; let id = UUID(); identifiers[key] = id; return id }
    func scopedID(_ scope: String, _ parts: String...) -> UUID { stableID(scope + "|" + parts.map { "\($0.utf8.count):\($0)" }.joined()) }
    func string(_ value: NativeJSONValue?) -> String? { if case .string(let text) = value { return text }; return nil }
    func flatten(_ items: [NativePanelItem]) -> [NativePanelItem] { items.flatMap { [$0] + flatten($0.children ?? []) } }

    /// 通过 Store 发命令并等待同一个 request id 的真实 ACK；不会由本地计时器生成成功。
    func request(_ name: String, _ params: [String: NativeJSONValue] = [:], timeoutSeconds: Int = 20, presentErrors: Bool = true) async -> Bool {
        lastErrorMessage = nil
        guard let store = nativeStore, let original = store.sendCommand, !store.isReference else { return false }
        return await withCheckedContinuation { continuation in
            var emitted = false
            store.sendCommand = { [weak self] command in
                guard let self else { continuation.resume(returning: false); return }
                guard !emitted else { original(command); return }
                emitted = true
                if !presentErrors { self.silentCommands.insert(command.id) }
                self.pendingCommands[command.id] = (self.string(command.params["contextId"]), continuation)
                self.commandTimeouts[command.id] = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(timeoutSeconds)) } catch { return }
                    self?.resolve(command.id, ok: false, error: "操作结果尚未确认，输入已保留，请重试。")
                }
                original(command)
            }
            var issued = params
            if ["device.add", "device.edit", "device.change", "device.move"].contains(name), issued["fieldRevision"] == nil {
                deviceFieldRevision += 1
                issued["fieldKey"] = .string("agentui-device-operation")
                issued["fieldRevision"] = .number(Double(deviceFieldRevision))
            }
            store.command(name, issued)
            store.sendCommand = original
            if !emitted { continuation.resume(returning: false) }
        }
    }
    func resolve(_ id: String, ok: Bool, error: String?) {
        guard let pending = pendingCommands.removeValue(forKey: id) else { return }
        commandTimeouts.removeValue(forKey: id)?.cancel()
        let silent = silentCommands.remove(id) != nil
        if !ok && !silent { reportError(error ?? "操作失败，输入已保留。") }
        pending.continuation.resume(returning: ok)
    }
    func fire(_ name: String, _ params: [String: NativeJSONValue] = [:]) { nativeStore?.command(name, params) }
    func perform(_ command: NativeCommand?) { nativeStore?.perform(command) }
    func closeNativePanel() { nativeStore?.closePanel(expectedID: nativePanel?.id) }
    func openSettingsPage(_ id: String) { fire("settings.open", ["id": .string(id)]) }
    func retryNavigation() { perform(navigationRetryCommand) }
    func searchDidChange() { nativeStore?.sidebarSearchText = searchText }
    func searchMentions(_ value: String) { fire("mention.search", ["value": .string(value)]) }
    func insertMention(_ option: NativeOption) { fire("mention.insert", ["id": .string(option.value)]) }
    func chooseAttachment(kind: String) { fire("attachment.pick", ["kind": .string(kind)]) }
    func attachmentPayload(_ items: [AttachmentItem]) -> [NativeJSONValue] {
        items.compactMap { item in
            guard let data = item.data else { return nil }
            return .object(["name": .string(item.name), "type": .string(item.mimeType ?? "application/octet-stream"), "data": .string(data.base64EncodedString())])
        }
    }
    func importAttachments(_ items: [AttachmentItem]) {
        let payload = attachmentPayload(items)
        guard nativeStore?.composerCanEdit == true, !payload.isEmpty else { return }
        fire("attachment.import", ["items": .array(payload)])
    }
    func importAttachmentsAndWait(_ items: [AttachmentItem]) async -> Bool {
        let payload = attachmentPayload(items)
        guard nativeStore?.composerCanEdit == true, !payload.isEmpty, payload.count == items.count else { reportError("附件内容不完整，请重新选择。"); return false }
        return await request("attachment.import", ["items": .array(payload)])
    }
    func removeAttachment(_ id: UUID) { if let raw = rawAttachmentIDs[id] { fire("attachment.remove", ["id": .string(raw)]) } }
    func previewAttachment(_ id: UUID) {
        guard let raw = rawAttachmentIDs[id], let item = nativeSnapshot.attachments.first(where: { $0.id == raw }) else { return }
        if let url = item.imageURL { previewItem = OutputItem(name: item.name, kind: .image, remoteURL: url) }
        else { fire("attachment.preview", ["id": .string(raw)]) }
    }
    func previewMessageBlock(messageID: UUID, blockID: String) {
        guard let raw = rawMessageIDs[messageID], let message = nativeSnapshot.messages.first(where: { $0.id == raw }), let item = flatten(message.blocks ?? []).first(where: { $0.id == blockID }) else { return }
        if let command = item.command { perform(command) }
        else { previewItem = output(item) }
    }

    @discardableResult func createConversation(project: String? = nil) -> UUID { beginNewConversation(project: project); return composer.id }
    func beginNewConversation(project: String? = nil, deviceID: UUID? = nil) {
        var params: [String: NativeJSONValue] = [:]
        if let deviceID, let raw = rawDeviceIDs[deviceID] { params["backendId"] = .string(raw) }
        if let project {
            let command = projectGroups[project]?.newCommand ?? projectGroups[project]?.command
            if params["backendId"] == nil {
                params["backendId"] = command?.params["backendId"] ?? selectedDeviceID.flatMap { rawDeviceIDs[$0] }.map(NativeJSONValue.string)
            }
            params["cwd"] = .string(command.flatMap { string($0.params["cwd"]) } ?? project)
        }
        nativeStore?.startNewConversation(params: params)
    }
    func open(_ id: UUID) { guard let raw = rawThreadIDs[id] else { return }; fire("thread.open", ["backendId": .string(raw.backend), "threadId": .string(raw.thread)]) }
    func selectListDevice(_ id: UUID?) { fire("backend.select", ["id": .string(id.flatMap { rawDeviceIDs[$0] } ?? "all")]) }
    func changeEditorDevice(_ id: UUID) { guard let raw = rawDeviceIDs[id] else { return }; fire("newchat.backend", ["value": .string(raw)]) }
    func configurationDidChange() {
        guard let store = nativeStore, store.composerCanEdit else { return }
        if selectedConversationID == nil, (composer.project ?? "") != (nativeSnapshot.cwd ?? "") {
            fire("newchat.project", ["value": .string(composer.project ?? "")])
            return
        }
        let config = composer.configuration
        if let model = nativeSnapshot.models.first(where: { $0.title == config.model }), model.value != nativeSnapshot.modelValue {
            store.chooseComposerOption("model.select", value: model.value, contextID: nativeSnapshot.contextId)
            // 由真实业务按新模型支持档位归一化；不能继续提交旧目录里的下标。
            return
        }
        let effort = Int(config.reasoning.rounded())
        if nativeSnapshot.efforts.indices.contains(effort), nativeSnapshot.efforts[effort].value != nativeSnapshot.effortValue { store.chooseComposerOption("effort.select", value: nativeSnapshot.efforts[effort].value, contextID: nativeSnapshot.contextId) }
        let speed = nativeSnapshot.speeds?.first(where: { ($0.value == "fast" || $0.value == "priority") == (config.speed == .fast) })
        if let speed, speed.value != nativeSnapshot.speedValue { store.chooseComposerOption("speed.select", value: speed.value, contextID: nativeSnapshot.contextId) }
        if let permission = nativeSnapshot.permissions?.first(where: { permissionMode($0.value) == config.permission }), permission.value != nativeSnapshot.permissionValue { store.chooseComposerOption("permission.select", value: permission.value, contextID: nativeSnapshot.contextId) }
    }
    func manage(_ id: UUID, action: String, value: String? = nil) { guard let raw = rawThreadIDs[id] else { return }; var params: [String: NativeJSONValue] = ["backendId": .string(raw.backend), "threadId": .string(raw.thread), "action": .string(action)]; if let value { params["value"] = .string(value) }; fire("thread.manage", params) }
    func togglePin(_ id: UUID) { manage(id, action: "pin") }
    func toggleProject(_ project: String) {
        if projectIsExpanded(project) { projectPageCounts[project] = 5 }
        perform(projectGroups[project]?.command)
    }
    func projectIsExpanded(_ project: String) -> Bool { !searchText.isEmpty || expandedProjects.contains(project) }
    func allProjectConversations(_ project: String) -> [Conversation] {
        visibleConversations.filter { !$0.isPinned && projectMembers[project]?.contains($0.id) == true }
    }
    func projectConversations(_ project: String) -> [Conversation] {
        let loaded = allProjectConversations(project)
        guard searchText.isEmpty else { return loaded }
        let limit = projectPageCounts[project] ?? 5
        var ordinaryCount = 0
        return loaded.filter { conversation in
            if conversation.isUnread && conversation.phase != .running { return true }
            ordinaryCount += 1
            return ordinaryCount <= limit
        }
    }
    private func ordinaryProjectConversationCount(_ project: String) -> Int {
        allProjectConversations(project).filter { !$0.isUnread || $0.phase == .running }.count
    }
    func projectDisplayName(_ key: String) -> String { projectGroups[key]?.title ?? key }
    func projectTitle(for path: String) -> String {
        let backend = currentDevice.flatMap { rawDeviceIDs[$0.id] }
        if let group = scopedProjects.compactMap({ projectGroups[$0] }).first(where: { group in
            let cwd = group.cwd ?? group.command.flatMap { string($0.params["cwd"]) }
            let owner = group.backendId ?? group.command.flatMap { string($0.params["backendId"]) }
            return cwd == path && (backend == nil || owner == backend)
        }) { return group.title }
        return path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
    }
    func reopenPendingRequests() {
        guard canReopenPendingRequests, let command = nativeSnapshot.conversationActions?.first(where: { $0.command?.name == "approval.reopen" && $0.disabled != true })?.command else { return }
        reopenRequestIntent = true
        perform(command)
    }
    func projectHasMore(_ project: String) -> Bool {
        (searchText.isEmpty && ordinaryProjectConversationCount(project) > (projectPageCounts[project] ?? 5)) ||
        projectGroups[project]?.actions?.contains { $0.command?.name == "project.more" } == true
    }
    func canLoadMoreProject(_ project: String) -> Bool {
        let action = projectGroups[project]?.actions?.first { $0.command?.name == "project.more" }
        return action?.disabled != true && projectHasMore(project)
    }
    func loadMoreProject(_ project: String) {
        guard canLoadMoreProject(project) else { return }
        let shown = projectPageCounts[project] ?? 5
        projectPageCounts[project] = shown + 5
        if ordinaryProjectConversationCount(project) <= shown {
            perform(projectGroups[project]?.actions?.first { $0.command?.name == "project.more" }?.command)
        }
    }
    func loadMoreConversations() { for project in scopedProjects where projectHasMore(project) { loadMoreProject(project) } }
    func retryProject(_ project: String) { perform(projectGroups[project]?.actions?.first { $0.command?.name == "project.retry" }?.command) }
    func refreshConversation(_ id: UUID) async { manage(id, action: "refresh") }
    func refreshAll() async { _ = await request("navigation.refresh") }
    func summarizeTitle(_ id: UUID) async -> (title: String?, error: String?) {
        guard let raw = rawThreadIDs[id] else { return (nil, "会话不可用，请刷新后重试") }
        let key = UUID().uuidString
        let ok = await request("thread.summarize", ["backendId": .string(raw.backend), "threadId": .string(raw.thread), "fieldKey": .string(key)], timeoutSeconds: 130, presentErrors: false)
        let result = nativeSnapshot.commandResults?.last { $0.name == "thread.summarize" && $0.fieldKey == key }
        return ok ? (result?.value, nil) : (nil, result?.error ?? "会话标题总结失败，请重试")
    }
    func rename(_ id: UUID, title: String) { guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }; manage(id, action: "rename", value: title) }
    @discardableResult func clone(_ id: UUID) -> UUID? { manage(id, action: "duplicate"); return nil }
    @discardableResult func archive(_ id: UUID, discardQueue: Bool = false) -> Bool { guard rawThreadIDs[id] != nil else { return false }; manage(id, action: "archive"); return true }
    func isResponding(in id: UUID) -> Bool { conversation(id)?.phase.isBusy == true }
    func stopResponse(in id: UUID) { guard selectedConversationID == id else { return }; fire("turn.stop") }
}
