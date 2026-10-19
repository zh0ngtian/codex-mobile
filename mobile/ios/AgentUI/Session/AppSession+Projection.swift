import Foundation

extension AppSession {
    func receive(_ snapshot: NativeSnapshot) {
        projecting = true
        defer { projecting = false }
        let previousContext = nativeSnapshot.contextId
        nativeSnapshot = snapshot
        for result in snapshot.commandResults ?? [] {
            if let pending = pendingCommands[result.id], let expected = pending.context, let actual = result.contextId, expected != actual { continue }
            resolve(result.id, ok: result.ok, error: result.error)
        }
        if previousContext != snapshot.contextId {
            historyEdit = nil; reopenRequestIntent = false
            for (id, pending) in pendingCommands where pending.context != nil && pending.context != snapshot.contextId { resolve(id, ok: false, error: "会话已切换，请返回原会话核对操作结果。") }
        }
        let searchGroups = snapshot.groups.filter { $0.category == "search" }
        let navigationFailure = snapshot.groups.first { $0.id == "list-error" || ($0.category == "search" && $0.subtitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) }
        // 搜索使用自己的请求进度；普通列表失败必须能越过尚未完成的加载标志。
        navigationLoading = searchGroups.isEmpty
            ? navigationFailure == nil && (snapshot.navigationLoading ?? !snapshot.ready)
            : searchGroups.contains { $0.loading == "loading" }
        navigationError = navigationFailure.map { $0.id == "list-error" ? $0.title : $0.subtitle ?? "" }
        navigationRetryCommand = navigationFailure?.actions?.compactMap(\.command).first ?? navigationFailure?.items.compactMap(\.command).first
        devices = snapshot.backends.filter { $0.id != "all" }.map { backend in
            let id = scopedID("device", backend.id); rawDeviceIDs[id] = backend.id
            let active = snapshot.backendId == backend.id
            let rawState = backend.connectionState ?? (backend.connected == true ? "online" : "offline")
            let connection: DeviceConnectionState = rawState == "online" ? .connected : rawState == "connecting" ? .connecting : rawState == "paused" ? .paused : .failed
            let models = active ? snapshot.models.map(\.title) : []
            let effort = active ? snapshot.efforts.map(\.title) : []
            let effortsByModel = active ? snapshot.models.reduce(into: [String: [String]]()) { result, model in
                result[model.title] = model.efforts?.map(\.title) ?? (model.value == snapshot.modelValue ? effort : [])
            } : [:]
            let permissions = active ? (snapshot.permissions ?? []).map { permissionMode($0.value) } : []
            return BackendDevice(id: id, name: backend.title, gatewayAddress: backend.gatewayAddress ?? "", enabled: backend.enabled ?? true, connection: connection, projects: backend.projects ?? [], capabilities: DeviceCapabilities(models: models, effortLevels: effort, effortsByModel: effortsByModel, supportsFast: active && (snapshot.speeds ?? []).contains { $0.value == "fast" || $0.value == "priority" }, permissions: permissions.reduce(into: [ApprovalMode]()) { if !$0.contains($1) { $0.append($1) } }), savedConfiguration: active ? configuration(snapshot) : ComposerConfiguration(), accountKey: backend.id)
        }
        selectedDeviceID = snapshot.listBackendId == "all" ? nil : (snapshot.listBackendId ?? snapshot.backendId).map { scopedID("device", $0) }
        let previouslyExpanded = expandedProjects
        projectGroups = [:]; scopedProjects = []; projectMembers = [:]; navigationIDs = []; expandedProjects = []; projectErrors = []; loadingProjects = []
        var listed: [UUID: Conversation] = [:]
        var ordered: [UUID] = []
        let old = Dictionary(uniqueKeysWithValues: conversations.map { ($0.id, $0) })
        for group in snapshot.groups {
            var projectKey: String?
            let groupCWD = group.command.flatMap { string($0.params["cwd"]) } ?? group.cwd
            let projectless = groupCWD == "codex-mobile://projectless"
            if group.category == "project" {
                // 展示名可以重复，展开与分页始终绑定真实 group 身份。
                let key = group.id
                if projectGroups[key] == nil { scopedProjects.append(key) }
                projectGroups[key] = group
                projectKey = key
                if group.collapsed != true { expandedProjects.insert(key) }
                else if previouslyExpanded.contains(key) { projectPageCounts[key] = 5 }
                if group.loading == "error" { projectErrors.insert(key) }
                if group.loading == "loading" { loadingProjects.insert(key) }
            }
            let allItems = group.allItems ?? group.items
            for item in allItems {
                guard let command = item.command, command.name == "thread.open", let backend = string(command.params["backendId"]), let raw = string(command.params["threadId"]) else { continue }
                let id = scopedID("thread", backend, raw); rawThreadIDs[id] = (backend, raw)
                if let projectKey { projectMembers[projectKey, default: []].insert(id) }
                navigationIDs.insert(id)
                if group.category == "search", let cwd = item.cwd, !cwd.isEmpty {
                    let name = URL(fileURLWithPath: cwd).lastPathComponent
                    let label = selectedDeviceID == nil ? "\(devices.first { rawDeviceIDs[$0.id] == backend }?.name ?? backend) · \(name)" : name
                    let key = "search-project|" + [group.id, backend, cwd].map { "\($0.utf8.count):\($0)" }.joined()
                    if projectGroups[key] == nil {
                        scopedProjects.append(key)
                        projectGroups[key] = NativeGroup(id: key, title: label, items: [])
                    }
                    projectMembers[key, default: []].insert(id)
                    expandedProjects.insert(key)
                }
                var thread = listed[id] ?? old[id] ?? Conversation(id: id, title: item.title, deviceID: scopedID("device", backend))
                thread.title = item.title
                thread.project = projectless ? nil : (item.cwd ?? (group.category == "project" ? group.cwd ?? group.title : nil))
                if thread.project == "" || thread.project == "无项目" || thread.project == "No project" { thread.project = nil }
                thread.isPinned = item.isPinned ?? (group.category == "pinned")
                thread.isUnread = item.isUnread ?? false
                thread.phase = item.running == true ? .running : .idle
                if listed[id] == nil { ordered.append(id) }; listed[id] = thread
            }
        }
        if let backend = snapshot.backendId, let raw = snapshot.threadId {
            let id = scopedID("thread", backend, raw); rawThreadIDs[id] = (backend, raw)
            selectedConversationID = id
            var thread = listed[id] ?? old[id] ?? Conversation(id: id, title: snapshot.title, deviceID: scopedID("device", backend))
            thread.title = snapshot.title; thread.readOnly = snapshot.readOnly
            if let cwd = snapshot.cwd { thread.project = cwd.isEmpty ? nil : cwd }
            thread.configuration = configuration(snapshot)
            let presentation = conversationMessages(snapshot.messages, running: snapshot.busy)
            thread.messages = presentation.messages
            thread.liveCommentary = presentation.liveCommentary
            thread.phase = snapshot.busy ? .running : .idle
            thread.detailError = snapshot.loading == "error"
            thread.queue = snapshot.queued.map { queued in
                let key = scopedID("queue", backend, raw, queued.id); rawQueueIDs[key] = queued.id
                let stateText = queued.queueState ?? "queued"
                let state: QueueState = stateText == "sending" ? .sending : stateText == "uncertain" ? .uncertain : stateText == "steering" ? .guiding : stateText == "failed" ? .failed : .queued
                let frozen = queued.configuration.map { ComposerConfiguration(model: $0.model ?? "", reasoning: 0, speed: ["fast", "priority"].contains($0.serviceTier ?? "") ? .fast : .normal, permission: permissionMode($0.permission ?? "")) } ?? ComposerConfiguration()
                return QueuedMessage(id: key, text: queued.inputText ?? queued.title, attachments: (queued.attachments ?? []).map(attachment), attachmentCount: queued.attachmentCount, configuration: frozen, configurationKnown: queued.configuration != nil, state: state, error: queued.error)
            }
            let older = snapshot.conversationActions?.first { $0.command?.name == "thread.older" }
            thread.olderTurns = older == nil ? 0 : 1; thread.loadedOlderTurns = 0
            thread.historyLoading = snapshot.olderTurnsState == "loading" || older?.disabled == true
            thread.historyError = snapshot.olderTurnsState == "error"
            if let tokens = snapshot.tokenUsage {
                thread.usage = UsageMetrics(lastRequestTokens: tokens.lastRequestTokens, contextCapacity: tokens.modelContextWindow, cumulativeInputTokens: tokens.inputTokens, cachedInputTokens: tokens.cachedInputTokens, cumulativeOutputTokens: tokens.outputTokens)
            } else { thread.usage = nil }
            if listed[id] == nil { ordered.append(id) }; listed[id] = thread
        } else { selectedConversationID = nil }
        if let backend = snapshot.backendId {
            accountQuotas[backend] = AccountQuota(sevenDayRemaining: snapshot.sevenDayRateLimit?.safeRemainingPercent.map { $0 / 100 }, fiveHourRemaining: snapshot.fiveHourRateLimit?.safeRemainingPercent.map { $0 / 100 }, sevenDayResetsAt: snapshot.sevenDayRateLimit?.resetsAt)
        }
        conversations = ordered.compactMap { listed[$0] }
        var editor = composer
        editor.deviceID = snapshot.backendId.map { scopedID("device", $0) }
        editor.text = nativeStore?.draft ?? snapshot.draft
        editor.attachments = snapshot.attachments.map(attachment)
        editor.configuration = configuration(snapshot)
        editor.project = snapshot.cwd.flatMap { $0.isEmpty ? nil : $0 } ?? selectedConversation?.project
        composer = editor
        if let id = selectedConversationID { editors[id] = editor } else { newEditor = editor }
        sidebarVisible = nativeStore?.sidebarOpen ?? snapshot.sidebarOpen ?? sidebarVisible
        searchText = nativeStore?.search ?? snapshot.search ?? searchText
        if !sidebarVisible { searchVisible = false; searchText = "" }
        if let error = snapshot.error, !error.isEmpty { toast = error }
        if let error = nativeStore?.commandError, !error.isEmpty { toast = error }
        let approvalPanel = snapshot.approvalPanel ?? (snapshot.panel?.id.hasPrefix("approval:") == true ? snapshot.panel : nil)
        projectRequests(approvalPanel)
        projectDrafts(snapshot.panel)
        projectAttachmentPreview(snapshot.panel)
        if let edit = historyEdit, let raw = rawMessageIDs[edit.messageID], let panel = snapshot.messages.first(where: { $0.id == raw })?.historyEdit, let field = panel.items.first(where: { $0.id == "history-text" }), let text = field.value, edit.text.isEmpty { historyEdit?.text = text }
    }

    func permissionMode(_ value: String) -> ApprovalMode {
        switch value { case "full-access", "fullAccess": .fullAccess; case "read-only", "readOnly": .readOnly; case "auto", "automatic", "approve-for-me", "auto-review": .automatic; case "custom": .custom; default: .ask }
    }
    func configuration(_ snapshot: NativeSnapshot) -> ComposerConfiguration {
        ComposerConfiguration(model: snapshot.models.first { $0.value == snapshot.modelValue }?.title ?? (snapshot.models.isEmpty ? "" : snapshot.model), reasoning: Double(snapshot.efforts.firstIndex { $0.value == snapshot.effortValue } ?? 0), speed: ["fast", "priority"].contains(snapshot.speedValue ?? "") ? .fast : .normal, permission: permissionMode(snapshot.permissionValue ?? ""))
    }
    func message(_ value: NativeMessage) -> ChatMessage {
        let id = scopedID("message", nativeSnapshot.contextId ?? "", value.id); rawMessageIDs[id] = value.id
        let created = value.timestamp.map { Date(timeIntervalSince1970: $0 > 10_000_000_000 ? $0 / 1000 : $0) } ?? Date(timeIntervalSince1970: 0)
        let blocks = flatten(value.presentationBlocks)
        let outputs = value.role == "user" ? [] : blocks.filter { ["image", "video", "html", "source"].contains($0.kind) }.map(output)
        let attachments: [AttachmentItem] = value.role == "user" ? blocks.filter { $0.kind == "image" }.map { item in
            AttachmentItem(id: scopedID("message-attachment", nativeSnapshot.contextId ?? "", value.id, item.id), name: item.title ?? item.id, kind: .image, remoteURL: item.previewURL ?? item.value)
        } : []

        let commentary = (value.commentary ?? []).map(progressEntry)
        return ChatMessage(id: id, isUser: value.role == "user", text: value.text, kind: value.phase == "commentary" ? "commentary" : value.role, duration: value.role == "assistant" && value.phase != "commentary" ? value.status ?? "" : "", timestamp: value.timestamp == nil ? "" : created.formatted(date: .omitted, time: .shortened), createdAt: created, attachments: attachments, commentary: commentary, outputs: outputs, quoteSource: value.quoteSource)
    }
    func attachment(_ value: NativeAttachment) -> AttachmentItem {
        let id = scopedID("attachment", nativeSnapshot.contextId ?? "", value.id); rawAttachmentIDs[id] = value.id
        let type = value.type ?? ""; let kind: AttachmentKind = type.hasPrefix("image/") ? .image : type.hasPrefix("audio/") ? .audio : type.hasPrefix("video/") ? .video : .file
        return AttachmentItem(id: id, name: value.name, kind: kind, remoteURL: value.imageURL, mimeType: value.type, byteCount: value.size)
    }
    func output(_ item: NativePanelItem) -> OutputItem {
        let kind: OutputKind = item.kind == "image" ? .image : item.kind == "video" ? .video : item.kind == "html" ? .html : item.kind == "source" ? .code : item.kind == "markdown" ? .markdown : .binary
        let value = item.previewURL ?? item.value
        let remote = value.flatMap { $0.hasPrefix("http://") || $0.hasPrefix("https://") || $0.hasPrefix("data:") ? $0 : nil }
        return OutputItem(id: scopedID("output", nativeSnapshot.contextId ?? "", item.id), name: item.title ?? item.id, kind: kind, content: item.text ?? (remote == nil ? value ?? "" : ""), remoteURL: remote, line: item.line)
    }
    func ownsAttachmentPreviewPanel(_ id: String) -> Bool {
        // 预览已关闭、业务panel尚未回执时，仍由原预览占有，避免再弹出普通sheet。
        id.hasPrefix("attachment:") && (previewItem != nil || presentedAttachmentPanelID == id)
    }
    func projectAttachmentPreview(_ panel: NativePanel?) {
        guard let panel, panel.id.hasPrefix("attachment:"), let download = panel.items.first(where: { $0.id == "draft-download" }), let source = download.value, source.hasPrefix("data:") else { presentedAttachmentPanelID = nil; return }
        guard presentedAttachmentPanelID != panel.id else { return }
        let content = panel.items.first { $0.id == "draft-content" }
        let kind: OutputKind
        switch content?.kind {
        case "source": kind = .code
        case "markdown": kind = .markdown
        case "html": kind = .html
        case "image": kind = .image
        case "audio", "video": kind = .video
        case "text": kind = .text
        default: kind = .binary
        }
        previewItem = OutputItem(id: scopedID("attachment-preview", nativeSnapshot.contextId ?? "", panel.id), name: download.title ?? panel.title, kind: kind, content: content?.text ?? panel.items.filter { ["draft-preview-limit", "draft-binary"].contains($0.id) }.compactMap(\.text).joined(separator: "\n"), remoteURL: source, line: content?.line)
        presentedAttachmentPanelID = panel.id
    }
    func projectDrafts(_ panel: NativePanel?) {
        guard let panel, panel.id == "drafts" else { return }
        var invalidRecord = false
        drafts = panel.items.filter { $0.kind == "section" }.compactMap { item in
            guard let data = item.value?.data(using: .utf8), let record = try? JSONDecoder().decode(NativeSavedDraftPresentation.self, from: data), let backend = record.backendId, let updated = record.updatedAt, updated.isFinite else { invalidRecord = true; return nil }
            let id = scopedID("draft", item.id); rawDraftIDs[id] = item.id
            let settings = record.settings
            let configuration = ComposerConfiguration(model: settings?.model ?? "", reasoning: Double(nativeSnapshot.efforts.firstIndex { $0.value == settings?.effort } ?? 0), speed: ["fast", "priority"].contains(settings?.serviceTier ?? "") ? .fast : .normal, permission: permissionMode(settings?.permissions ?? ""))
            let attachments = ((record.images ?? []) + (record.files ?? [])).map { attachment -> AttachmentItem in
                let type = attachment.type ?? ""
                let kind: AttachmentKind = type.hasPrefix("image/") ? .image : type.hasPrefix("audio/") ? .audio : type.hasPrefix("video/") ? .video : .file
                return AttachmentItem(id: scopedID("draft-attachment", item.id, attachment.id ?? attachment.name ?? ""), name: attachment.name ?? "", kind: kind, remoteURL: attachment.url, mimeType: attachment.type, byteCount: attachment.size)
            }
            let composition = ComposerDraft(deviceID: scopedID("device", backend), project: record.cwd, text: record.text ?? "", attachments: attachments, configuration: configuration, savedDraftID: id)
            return DraftRecord(id: id, composition: composition, updatedAt: Date(timeIntervalSince1970: updated / 1000))
        }
        draftReadError = invalidRecord || panel.items.contains { $0.id == "drafts-error" }
        if invalidRecord { persistenceError = "草稿资料不完整，请重新读取。" }
        else { persistenceError = panel.items.first { $0.id == "drafts-error" }?.text }

    }
}

private struct NativeSavedDraftPresentation: Decodable {
    var backendId: String?
    var cwd: String?
    var text: String?
    var updatedAt: Double?
    var settings: Settings?
    var images: [Attachment]?
    var files: [Attachment]?
    struct Settings: Decodable { var model: String?; var effort: String?; var serviceTier: String?; var permissions: String? }
    struct Attachment: Decodable { var id: String?; var name: String?; var type: String?; var url: String?; var size: Int? }
}
