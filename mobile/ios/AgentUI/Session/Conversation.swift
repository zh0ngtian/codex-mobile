import Foundation

struct Conversation: Identifiable, Codable, Equatable, Hashable, Sendable {
    var id = UUID()
    var title: String
    var project: String?
    var isPinned = false
    var messages: [ChatMessage] = []
    var deviceID = UUID()
    var configuration = ComposerConfiguration()
    var phase = RunPhase.idle
    var isArchived = false
    var isUnread = false
    var readOnly = false
    var queue: [QueuedMessage] = []
    var liveCommentary: [ProgressEntry] = []
    var usage: UsageMetrics? = nil
    var olderTurns = 0
    var loadedOlderTurns = 0
    var historyError = false
    var detailError = false
    var historyLoading = false
    var canModify: Bool { !readOnly && !isArchived }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.title == rhs.title && lhs.project == rhs.project && lhs.isPinned == rhs.isPinned && lhs.messages == rhs.messages && lhs.configuration == rhs.configuration && lhs.phase == rhs.phase && lhs.isArchived == rhs.isArchived && lhs.isUnread == rhs.isUnread && lhs.readOnly == rhs.readOnly && lhs.queue == rhs.queue && lhs.liveCommentary == rhs.liveCommentary && lhs.usage == rhs.usage && lhs.olderTurns == rhs.olderTurns && lhs.loadedOlderTurns == rhs.loadedOlderTurns && lhs.historyError == rhs.historyError && lhs.detailError == rhs.detailError && lhs.historyLoading == rhs.historyLoading && lhs.deviceID == rhs.deviceID
    }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
