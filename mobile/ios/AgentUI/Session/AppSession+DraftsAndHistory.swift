import Foundation

extension AppSession {
    @discardableResult func saveDraft() -> Bool {
        guard canSaveDraft else { return false }
        Task { _ = await request("draft.save") }
        return true
    }
    @discardableResult func restoreDraft(_ id: UUID) -> Bool { guard let raw = rawDraftIDs[id] else { return false }; fire("drafts.restore", ["id": .string(raw)]); return true }
    func restoreDraftAndWait(_ id: UUID) async -> Bool {
        guard let raw = rawDraftIDs[id] else { return false }
        let ok = await request("drafts.restore", ["id": .string(raw)])
        if ok { draftsPresented = false }
        return ok
    }
    func deleteDraft(_ id: UUID) { if let raw = rawDraftIDs[id] { fire("drafts.remove", ["id": .string(raw)]) } }
    func reloadDrafts() { fire(nativePanel?.id == "drafts" ? "drafts.retry" : "drafts.open") }
    func canEditHistory(_ id: UUID) -> Bool { canInteract(id) && !isBusy && historyEdit == nil && nativeSnapshot.pending != true }
    func beginHistoryEdit(conversationID: UUID, messageID: UUID) {
        guard canEditHistory(conversationID), let raw = rawMessageIDs[messageID], let message = nativeSnapshot.messages.first(where: { $0.id == raw }), let action = message.actions?.first(where: { $0.command?.name == "message.edit" })?.command else { return }
        historyEdit = HistoryEdit(conversationID: conversationID, messageID: messageID, text: message.text)
        perform(action)
    }
    func cancelHistoryEdit() {
        guard let edit = historyEdit, let raw = rawMessageIDs[edit.messageID], let panel = nativeSnapshot.messages.first(where: { $0.id == raw })?.historyEdit, let command = panel.items.first(where: { $0.command?.name == "history.cancel" })?.command else { historyEdit = nil; return }
        perform(command); historyEdit = nil
    }
    func historyEditHasFollowing() -> Bool { guard let edit = historyEdit, let messages = conversation(edit.conversationID)?.messages, let position = messages.firstIndex(where: { $0.id == edit.messageID }) else { return false }; return position < messages.count - 1 }
    @discardableResult func submitHistoryEdit(confirmed: Bool = false) -> Bool {
        guard let edit = historyEdit, let raw = rawMessageIDs[edit.messageID], let panel = nativeSnapshot.messages.first(where: { $0.id == raw })?.historyEdit, let field = panel.items.first(where: { $0.id == "history-text" }), let change = field.command, let submit = panel.items.first(where: { $0.command?.name == "history.submit" })?.command else { return false }
        Task {
            var params = change.params; params["value"] = .string(edit.text)
            guard await request(change.name, params) else { return }
            params = submit.params; params["confirmed"] = .bool(confirmed)
            if await request(submit.name, params), nativeSnapshot.messages.first(where: { $0.id == raw })?.historyEdit == nil { historyEdit = nil }
        }
        return true
    }
    func loadEarlier(_ id: UUID) async { guard selectedConversationID == id else { return }; _ = await request("thread.older") }
}
