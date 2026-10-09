import Foundation

struct NativeConversationRow: Codable, Equatable {
    let id: String
    let role: String
    let text: String
    var detail: String? = nil
    var turnId: String? = nil
    var messageId: String? = nil
    var timestamp: String? = nil
    var rich: Bool? = nil
}
struct NativeConversationAttachment: Codable, Equatable {
    let id: String
    let name: String
    let kind: String
    var url: String? = nil
}
struct NativeConversationChoice: Codable, Equatable {
    let id: String
    let label: String
    var description: String? = nil
}
struct NativeConversationQueued: Codable, Equatable {
    let id: String
    let text: String
    let failed: Bool
}
struct NativeConversationSnapshot: Decodable {
    var version = 1
    var locale = "zh-CN"
    var isNewChat = false
    var contextId: String
    var visible = true
    var title = "Codex"
    var subtitle = ""
    var draft = ""
    var acknowledgedSequence = 0
    var draftCursor: Int?
    var draftCursorSequence: Int?
    var enabled = true
    var sendEnabled = true
    var sendLabel = "发送"
    var busy = false
    var error = ""
    var status = ""
    var loadState = "ready"
    var olderTurnsState = "idle"
    var fontSize: Double = 16
    var rows: [NativeConversationRow] = []
    var attachments: [NativeConversationAttachment] = []
    var mentions: [NativeConversationChoice] = []
    var projects: [NativeConversationChoice] = []
    var backends: [NativeConversationChoice] = []
    var selectedProject: String? = nil
    var selectedBackendId: String? = nil
    var settingsLabel = "模型与权限"
    var queued: [NativeConversationQueued] = []

    var allowsConversationActions: Bool { enabled && loadState == "ready" && !isNewChat }
    var allowsEditingMessages: Bool { enabled && loadState == "ready" && !busy }

    init(contextId: String, draft: String = "", acknowledgedSequence: Int = 0) {
        self.contextId = contextId
        self.draft = draft
        self.acknowledgedSequence = acknowledgedSequence
    }

    private enum CodingKeys: String, CodingKey {
        case version, locale, isNewChat, contextId, visible, title, subtitle, draft, acknowledgedSequence, draftCursor, draftCursorSequence
        case enabled, sendEnabled, sendLabel, busy, error, status, loadState, olderTurnsState, fontSize
        case rows, attachments, mentions, projects, backends, selectedProject, selectedBackendId, settingsLabel, queued
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try values.decode(String.self, forKey: .contextId)
        locale = try values.decodeIfPresent(String.self, forKey: .locale) ?? "zh-CN"
        isNewChat = try values.decodeIfPresent(Bool.self, forKey: .isNewChat) ?? false
        version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
        visible = try values.decodeIfPresent(Bool.self, forKey: .visible) ?? true
        title = try values.decodeIfPresent(String.self, forKey: .title) ?? "Codex"
        subtitle = try values.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
        draft = try values.decodeIfPresent(String.self, forKey: .draft) ?? ""
        acknowledgedSequence = try values.decodeIfPresent(Int.self, forKey: .acknowledgedSequence) ?? 0
        draftCursor = try values.decodeIfPresent(Int.self, forKey: .draftCursor)
        draftCursorSequence = try values.decodeIfPresent(Int.self, forKey: .draftCursorSequence)
        enabled = try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        sendEnabled = try values.decodeIfPresent(Bool.self, forKey: .sendEnabled) ?? true
        sendLabel = try values.decodeIfPresent(String.self, forKey: .sendLabel) ?? NativeConversationStrings(locale: locale).text(.send)
        busy = try values.decodeIfPresent(Bool.self, forKey: .busy) ?? false
        error = try values.decodeIfPresent(String.self, forKey: .error) ?? ""
        status = try values.decodeIfPresent(String.self, forKey: .status) ?? ""
        loadState = try values.decodeIfPresent(String.self, forKey: .loadState) ?? "ready"
        olderTurnsState = try values.decodeIfPresent(String.self, forKey: .olderTurnsState) ?? "idle"
        fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 16
        rows = try values.decodeIfPresent([NativeConversationRow].self, forKey: .rows) ?? []
        attachments = try values.decodeIfPresent([NativeConversationAttachment].self, forKey: .attachments) ?? []
        mentions = try values.decodeIfPresent([NativeConversationChoice].self, forKey: .mentions) ?? []
        projects = try values.decodeIfPresent([NativeConversationChoice].self, forKey: .projects) ?? []
        backends = try values.decodeIfPresent([NativeConversationChoice].self, forKey: .backends) ?? []
        selectedProject = try values.decodeIfPresent(String.self, forKey: .selectedProject)
        selectedBackendId = try values.decodeIfPresent(String.self, forKey: .selectedBackendId)
        settingsLabel = try values.decodeIfPresent(String.self, forKey: .settingsLabel) ?? NativeConversationStrings(locale: locale).text(.settings)
        queued = try values.decodeIfPresent([NativeConversationQueued].self, forKey: .queued) ?? []
    }
}
struct NativeConversationAction: Encodable {
    let contextId: String
    let sequence: Int
    let type: String
    var text: String? = nil
    var id: String? = nil
    var cursor: Int? = nil
}
/// React 是持久化权威；这里只协调尚未确认的编辑和一次提交锁。
final class NativeConversationState {
    private(set) var snapshot: NativeConversationSnapshot?
    private(set) var draft = ""
    private(set) var sequence = 0
    private var draftSequence = 0
    private var submissionSequence: Int?
    private var suggestedCursor: (sequence: Int, cursor: Int)?
    private var consumedCursorSequence = -1
    var submissionPending: Bool { submissionSequence != nil }

    @discardableResult
    func apply(_ next: NativeConversationSnapshot, hasMarkedText: Bool) -> Bool {
        let changed = snapshot?.contextId != next.contextId
        if changed {
            draftSequence = 0
            submissionSequence = nil
            suggestedCursor = nil
            consumedCursorSequence = -1
        }
        snapshot = next
        if changed || (!hasMarkedText && next.acknowledgedSequence >= draftSequence) {
            draft = next.draft
        }
        if !hasMarkedText, let cursor = next.draftCursor, let cursorSequence = next.draftCursorSequence,
           cursorSequence >= draftSequence, cursorSequence > consumedCursorSequence,
           next.acknowledgedSequence >= cursorSequence {
            suggestedCursor = (cursorSequence, cursor)
        }
        if let submitted = submissionSequence, next.acknowledgedSequence >= submitted {
            submissionSequence = nil
        }
        return changed
    }

    func action(_ type: String, text: String? = nil, id: String? = nil, cursor: Int? = nil) -> NativeConversationAction? {
        guard let snapshot else { return nil }
        if type == "submit" && (submissionPending || !snapshot.enabled || !snapshot.sendEnabled) { return nil }
        sequence += 1
        if type == "draft" {
            draft = text ?? ""
            draftSequence = sequence
            suggestedCursor = nil
        }
        if type == "submit" { submissionSequence = sequence }
        return NativeConversationAction(contextId: snapshot.contextId, sequence: sequence, type: type,
                                        text: text, id: id, cursor: cursor)
    }

    /// 每个 React 光标结果只使用一次；随后本地选区编辑拥有更高序列。
    func consumeSuggestedCursor(hasMarkedText: Bool) -> Int? {
        guard !hasMarkedText, let suggestion = suggestedCursor else { return nil }
        suggestedCursor = nil
        guard suggestion.sequence >= draftSequence, suggestion.sequence > consumedCursorSequence else { return nil }
        consumedCursorSequence = suggestion.sequence
        return suggestion.cursor
    }

    func hide(contextId: String) -> Bool {
        guard snapshot?.contextId == contextId else { return false }
        snapshot?.visible = false
        return true
    }
}

enum NativeConversationScrollPolicy {
    static func shouldFollow(contextChanged: Bool, nearBottom: Bool) -> Bool {
        contextChanged || nearBottom
    }
}

struct NativeConversationStrings {
    enum Key: CaseIterable {
        case done, back, menu, retry, older, latest, attachments, photos, files, location, composer, send, stop, queue
        case loading, loadingOlder, retryOlder, web, pin, duplicate, rename, archive, model, permissions
        case project, backend, choose, retryPrefix, queuePrefix, sendNow, cancelQueued
        case toolDetails, fullContent, edit, user, assistant, tool, system, detailsTitle, copyAll, settings
    }
    let locale: String
    private static let values: [Key: (String, String)] = [
        .done: ("完成", "Done"), .back: ("打开会话列表", "Open conversation list"), .menu: ("会话菜单", "Conversation menu"),
        .retry: ("重试", "Retry"), .older: ("加载更早消息", "Load older messages"), .latest: ("跳到最新 ↓", "Jump to latest ↓"),
        .attachments: ("添加附件", "Add attachment"), .photos: ("照片", "Photos"), .files: ("文件", "Files"), .location: ("位置", "Location"),
        .composer: ("向 Codex 提问", "Ask Codex"), .send: ("发送", "Send"), .stop: ("停止", "Stop"), .queue: ("排队", "Queue"),
        .loading: ("正在加载会话…", "Loading conversation…"), .loadingOlder: ("正在加载更早消息…", "Loading older messages…"),
        .retryOlder: ("重试加载更早消息", "Retry loading older messages"), .web: ("在完整页面查看", "View full page"),
        .pin: ("置顶", "Pin"), .duplicate: ("复制会话", "Duplicate conversation"), .rename: ("重命名", "Rename"), .archive: ("归档", "Archive"),
        .model: ("模型设置", "Model settings"), .permissions: ("权限设置", "Permission settings"), .project: ("项目", "Project"), .backend: ("设备", "Device"),
        .choose: ("选择", "Choose "), .retryPrefix: ("重试：", "Retry: "), .queuePrefix: ("排队：", "Queued: "),
        .sendNow: ("立即发送", "Send now"), .cancelQueued: ("取消排队", "Cancel queued message"),
        .toolDetails: ("查看工具详情", "View tool details"), .fullContent: ("查看完整内容", "View full content"), .edit: ("编辑重发", "Edit and resend"),
        .user: ("你", "You"), .assistant: ("Codex", "Codex"), .tool: ("工具", "Tool"), .system: ("系统", "System"),
        .detailsTitle: ("工具详情", "Tool details"), .copyAll: ("复制全文", "Copy all"), .settings: ("模型与权限", "Model & permissions")
    ]
    func text(_ key: Key) -> String {
        guard let values = Self.values[key] else { return "" }
        return locale.lowercased().hasPrefix("en") ? values.1 : values.0
    }
}
