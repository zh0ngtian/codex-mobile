import Foundation

extension AppSession {
    @discardableResult func submitCurrent() -> SubmissionResult {
        guard canSubmit else { return .ignored }
        let target = selectedConversationID ?? composer.id
        let queued = nativeSnapshot.busy
        submissionPending = true
        Task { [weak self] in
            guard let self else { return }
            _ = await self.request("message.send")
            self.submissionPending = false
            // 只有业务快照确认后才清空输入与附件；失败或切换上下文不会提交本地副本。
        }
        return queued ? .queued(target) : .started(target)
    }
    func stopRun(_ id: UUID, advanceQueue: Bool) { stopResponse(in: id) }
    @discardableResult func editQueuedMessage(conversationID: UUID, id: UUID, text: String) -> Bool {
        guard canInteract(conversationID), let raw = rawQueueIDs[id], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        fire("queue.edit", ["id": .string(raw), "value": .string(text)])
        return true
    }
    func editQueuedMessageAndWait(conversationID: UUID, id: UUID, text: String) async -> Bool {
        guard canInteract(conversationID), let raw = rawQueueIDs[id], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || conversation(conversationID)?.queue.first(where: { $0.id == id })?.attachments.isEmpty == false else { return false }
        return await request("queue.edit", ["id": .string(raw), "value": .string(text)])
    }
    @discardableResult func cancelQueuedMessage(conversationID: UUID, id: UUID, confirmed: Bool = false) -> Bool {
        guard canInteract(conversationID), let raw = rawQueueIDs[id] else { return false }
        fire("queue.cancel", ["id": .string(raw), "confirmed": .bool(confirmed)])
        return true
    }
    func retryQueuedMessage(conversationID: UUID, id: UUID) { guard canInteract(conversationID), let raw = rawQueueIDs[id] else { return }; fire("queue.send", ["id": .string(raw)]) }
    func steerQueuedMessage(conversationID: UUID, id: UUID) async { guard canInteract(conversationID), let raw = rawQueueIDs[id] else { return }; _ = await request("queue.send", ["id": .string(raw)]) }
}
