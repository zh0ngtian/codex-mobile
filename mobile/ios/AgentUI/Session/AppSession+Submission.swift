import Foundation

extension AppSession {
    @discardableResult func submitCurrent() -> SubmissionResult {
        guard canSubmit else { return .ignored }
        let target = selectedConversationID ?? composer.id
        let queued = nativeSnapshot.busy
        prepareFirstMessage()
        let firstID = firstMessageSubmission?.id
        submissionPending = true
        Task { [weak self] in
            guard let self else { return }
            let ok = await self.request("message.send", presentErrors: firstID == nil) { command in
                if self.firstMessageSubmission?.id == firstID { self.firstMessageSubmission?.commandID = command.id }
            }
            self.submissionPending = false
            if !ok, self.firstMessageSubmission?.id == firstID, self.firstMessageSubmission?.commandID == nil {
                self.firstMessageSubmission?.state = .failed
                self.firstMessageSubmission?.error = "消息未发送，输入已保留。"
            }
            self.reconcileFirstMessage()
            // 只有业务快照确认后才清空输入与附件；失败或切换上下文不会提交本地副本。
        }
        return queued ? .queued(target) : .started(target)
    }
    func stopRun(_ id: UUID, advanceQueue: Bool) { stopResponse(in: id) }
    func queuedContentExists(conversationID: UUID, id: UUID, text: String) -> Bool {
        guard let queued = conversation(conversationID)?.queue.first(where: { $0.id == id }) else { return false }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !queued.attachments.isEmpty || (queued.attachmentCount ?? 0) > 0
    }
    @discardableResult func editQueuedMessage(conversationID: UUID, id: UUID, text: String) -> Bool {
        guard canInteract(conversationID), let raw = rawQueueIDs[id], queuedContentExists(conversationID: conversationID, id: id, text: text) else { return false }
        fire("queue.edit", ["id": .string(raw), "value": .string(text)])
        return true
    }
    func editQueuedMessageAndWait(conversationID: UUID, id: UUID, text: String) async -> Bool {
        guard canInteract(conversationID), let raw = rawQueueIDs[id], queuedContentExists(conversationID: conversationID, id: id, text: text) else { return false }
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
