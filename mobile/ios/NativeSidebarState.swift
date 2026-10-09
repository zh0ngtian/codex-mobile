import Foundation

struct NativeSidebarBackend: Codable, Equatable {
    var id: String
    var label: String
    var detail = ""
    var online = false
    var loading = false
    var approvalCount = 0
}

struct NativeSidebarRow: Codable, Equatable {
    var id: String
    var threadId: String
    var title: String
    var source = ""
    var time = ""
    var snippet = ""
    var pinned = false
    var unread = false
    var running = false
    var opening = false
    var readOnly = false
}

struct NativeSidebarSection: Codable, Equatable {
    var id: String
    var title: String
    var backendId = ""
    var cwd = ""
    var collapsible = false
    var expanded = true
    var loading = false
    var error = false
    var more = false
    var rows: [NativeSidebarRow] = []
}

enum NativeSidebarEmptyState { case error, loading, searching, noResults, empty }

struct NativeSidebarSnapshot: Decodable {
    var version = 1
    var contextId: String
    var visible = true
    var acknowledgedSequence = 0
    var locale = "zh-CN"
    var fontSize: Double = 16
    var query = ""
    var title = "Codex Mobile"
    var subtitle = ""
    var selectedBackendId = ""
    var backends: [NativeSidebarBackend] = []
    var sections: [NativeSidebarSection] = []
    var loadState = "ready"
    var searching = false
    var refreshing = false
    var error = ""
    var pendingKey = ""
    var pendingAction = ""
    var strings: [String: String] = [:]

    var hasError: Bool { loadState == "error" || !error.isEmpty }
    var allowsRowActions: Bool { visible && pendingAction.isEmpty }
    func emptyState(query: String) -> NativeSidebarEmptyState {
        if hasError { return .error }
        if searching { return .searching }
        if loadState == "loading" { return .loading }
        return query.isEmpty ? .empty : .noResults
    }

    init(contextId: String, query: String = "", acknowledgedSequence: Int = 0) {
        self.contextId = contextId
        self.query = query
        self.acknowledgedSequence = acknowledgedSequence
    }

    private enum CodingKeys: String, CodingKey {
        case version, contextId, visible, acknowledgedSequence, locale, fontSize, query, title, subtitle
        case selectedBackendId, backends, sections, loadState, searching, refreshing, error
        case pendingKey, pendingAction, strings
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try values.decode(String.self, forKey: .contextId)
        version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
        visible = try values.decodeIfPresent(Bool.self, forKey: .visible) ?? true
        acknowledgedSequence = try values.decodeIfPresent(Int.self, forKey: .acknowledgedSequence) ?? 0
        locale = try values.decodeIfPresent(String.self, forKey: .locale) ?? "zh-CN"
        fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 16
        query = try values.decodeIfPresent(String.self, forKey: .query) ?? ""
        title = try values.decodeIfPresent(String.self, forKey: .title) ?? "Codex Mobile"
        subtitle = try values.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
        selectedBackendId = try values.decodeIfPresent(String.self, forKey: .selectedBackendId) ?? ""
        backends = try values.decodeIfPresent([NativeSidebarBackend].self, forKey: .backends) ?? []
        sections = try values.decodeIfPresent([NativeSidebarSection].self, forKey: .sections) ?? []
        loadState = try values.decodeIfPresent(String.self, forKey: .loadState) ?? "ready"
        searching = try values.decodeIfPresent(Bool.self, forKey: .searching) ?? false
        refreshing = try values.decodeIfPresent(Bool.self, forKey: .refreshing) ?? false
        error = try values.decodeIfPresent(String.self, forKey: .error) ?? ""
        pendingKey = try values.decodeIfPresent(String.self, forKey: .pendingKey) ?? ""
        pendingAction = try values.decodeIfPresent(String.self, forKey: .pendingAction) ?? ""
        strings = try values.decodeIfPresent([String: String].self, forKey: .strings) ?? [:]
    }
}

struct NativeSidebarAction: Encodable {
    let contextId: String
    let sequence: Int
    let type: String
    var id: String? = nil
    var text: String? = nil
}

/// React 管理业务状态；本地只保护尚未确认的搜索和重复交互。
final class NativeSidebarState {
    private(set) var snapshot: NativeSidebarSnapshot?
    private(set) var query = ""
    private(set) var sequence = 0
    private var querySequence = 0
    private var pendingActions: [String: Int] = [:]

    @discardableResult
    func apply(_ next: NativeSidebarSnapshot, hasMarkedText: Bool) -> Bool {
        guard next.version == 1, !next.contextId.isEmpty,
              unique(next.backends.map(\.id)), unique(next.sections.map(\.id)),
              unique(next.sections.flatMap { $0.rows.map(\.id) }) else { return false }
        let contextChanged = snapshot?.contextId != next.contextId
        let reopened = snapshot?.visible != true && next.visible
        if contextChanged || reopened {
            querySequence = 0
            pendingActions.removeAll()
        }
        snapshot = next
        sequence = max(sequence, next.acknowledgedSequence)
        pendingActions = pendingActions.filter { $0.value > next.acknowledgedSequence }
        if !next.visible {
            resetSearch()
        } else if contextChanged || reopened || (!hasMarkedText && next.acknowledgedSequence >= querySequence) {
            query = next.query
        }
        return true
    }

    func action(_ type: String, text: String? = nil, id: String? = nil) -> NativeSidebarAction? {
        guard let snapshot, snapshot.visible else { return nil }
        let key = "\(type):\(id ?? "")"
        guard type == "query" || pendingActions[key] == nil else { return nil }
        if snapshot.pendingAction == type && snapshot.pendingKey == (id ?? "") { return nil }
        switch type {
        case "query", "close", "new", "devices": break
        case "refresh":
            guard !snapshot.refreshing else { return nil }
        case "backend":
            guard let id, snapshot.backends.contains(where: { $0.id == id }) else { return nil }
        case "project-collapse", "project-more", "project-retry":
            guard let section = snapshot.sections.first(where: { $0.id == id }), !section.loading else { return nil }
            if type == "project-collapse" && (!section.collapsible || !query.isEmpty) { return nil }
            if type == "project-more" && !section.more { return nil }
            if type == "project-retry" && !section.error { return nil }
        case "open", "pin", "refresh-thread", "duplicate", "rename", "archive", "copy":
            guard snapshot.allowsRowActions else { return nil }
            guard let row = snapshot.sections.flatMap(\.rows).first(where: { $0.id == id }) else { return nil }
            if type == "open" && row.opening { return nil }
            if row.readOnly && ["duplicate", "rename", "archive"].contains(type) { return nil }
            if type == "rename" && (text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) { return nil }
        default: return nil
        }
        sequence += 1
        if type == "query" {
            query = text ?? ""
            querySequence = sequence
        } else {
            pendingActions[key] = sequence
        }
        if type == "close" { query = ""; querySequence = sequence }
        return NativeSidebarAction(contextId: snapshot.contextId, sequence: sequence, type: type, id: id, text: text)
    }

    @discardableResult
    func hide(contextId: String) -> Bool {
        guard var current = snapshot, current.contextId == contextId else { return false }
        current.visible = false
        snapshot = current
        resetSearch()
        pendingActions.removeAll()
        return true
    }

    private func resetSearch() { query = ""; querySequence = 0 }
    private func unique(_ ids: [String]) -> Bool { !ids.contains("") && Set(ids).count == ids.count }
}

struct NativeSidebarStrings {
    let snapshot: NativeSidebarSnapshot?
    func text(_ key: String) -> String {
        if let translated = snapshot?.strings[key], !translated.isEmpty { return translated }
        let english = snapshot?.locale.lowercased().hasPrefix("en") == true
        let labels: [String: (String, String)] = [
            "close": ("关闭", "Close"), "newChat": ("新聊天", "New chat"), "search": ("搜索会话", "Search chats"),
            "refresh": ("刷新", "Refresh"), "devices": ("管理设备", "Manage devices"), "selectBackend": ("选择设备", "Select device"),
            "allBackends": ("所有设备", "All devices"), "loading": ("正在加载…", "Loading…"), "searching": ("正在搜索…", "Searching…"),
            "noResults": ("没有找到会话", "No chats found"), "noResultsHint": ("试试会话名称或内容", "Try a chat name or its contents"),
            "empty": ("暂无会话", "No chats yet"), "loadError": ("加载失败", "Could not load chats"), "retry": ("重试", "Retry"),
            "more": ("加载更多", "Load more"), "pin": ("置顶", "Pin"), "unpin": ("取消置顶", "Unpin"),
            "refreshThread": ("刷新会话", "Refresh chat"), "duplicate": ("创建副本", "Duplicate"), "copy": ("复制会话 ID", "Copy chat ID"),
            "rename": ("重命名", "Rename"), "archive": ("归档", "Archive"), "renamePrompt": ("会话名称", "Chat name"),
            "cancel": ("取消", "Cancel"), "save": ("保存", "Save"), "running": ("执行中", "Running"), "unread": ("未读", "Unread"), "approvals": ("个待审批", "awaiting approval"), "expanded": ("已展开", "Expanded"), "collapsed": ("已折叠", "Collapsed")
        ]
        guard let label = labels[key] else { return key }
        return english ? label.1 : label.0
    }
}
