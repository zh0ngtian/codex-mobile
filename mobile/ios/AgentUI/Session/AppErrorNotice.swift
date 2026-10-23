import Foundation

struct AppErrorNotice: Identifiable, Equatable, Sendable {
    let id = UUID()
    let message: String
}

extension AppSession {
    func reportError(_ message: String) {
        guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        lastErrorMessage = message
        guard !errorNotices.contains(where: { $0.message == message }) else { return }
        errorNotices.append(AppErrorNotice(message: message))
    }

    func dismissError(_ id: UUID) {
        errorNotices.removeAll { $0.id == id }
    }

    /// 快照中的错误是状态；确认后只有状态变化或新的命令失败才再次提示。
    func receiveError(_ message: String?, source: String, contextID: String?) {
        let message = message.flatMap { $0.isEmpty ? nil : $0 }
        let identity = message.map { "\(contextID?.utf8.count ?? 0):\(contextID ?? "")|\($0)" }
        guard projectedErrors[source] != identity else { return }
        projectedErrors[source] = identity
        if let message { reportError(message) }
    }
}
