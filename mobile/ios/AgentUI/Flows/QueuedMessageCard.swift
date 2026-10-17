import SwiftUI

struct QueuedMessageCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var editing = false
    @State private var editedText = ""
    @State private var savingEdit = false
    @State private var confirmingUncertainCancellation = false
    let conversationID: UUID
    let message: QueuedMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Label(message.state.title(using: preferences), systemImage: message.state.symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(message.state.color)
                if busy { ProgressView().controlSize(.small) }
                Spacer(minLength: 0)
                Text(message.configurationKnown ? message.configuration.model : preferences.text("配置未返回", "Configuration unavailable"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if editing {
                TextField(preferences.text("编辑消息…", "Edit message…"), text: $editedText, axis: .vertical)
                    .lineLimit(3...8)
                    .font(.body)
                    .padding(12)
                    .background(AgentTheme.page, in: RoundedRectangle(cornerRadius: 12))
                    .disabled(!canEdit || savingEdit)
                    .accessibilityLabel(preferences.text("队列消息正文", "Queued message text"))
            } else if !message.text.isEmpty {
                Text(message.text)
                    .font(.subheadline)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(preferences.text("仅附件消息", "Attachments only"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            FlowAttachmentSummary(attachments: message.attachments)
            if let error = message.error {
                FlowErrorBanner(message: error)
            }
            if message.state == .uncertain {
                Text(preferences.text("消息可能已送达。确认结果前，后续队列会暂停。", "This message may have been delivered. The remaining queue is paused until the result is confirmed."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if editing {
                HStack(spacing: 12) {
                    Button(preferences.text("保存", "Save"), action: saveEdit)
                        .buttonStyle(.borderedProminent)
                        .frame(minHeight: 44)
                        .disabled(!canEdit || !editedHasContent || savingEdit)
                    Button(preferences.text("取消编辑", "Cancel edit"), action: cancelEdit)
                        .frame(minHeight: 44).disabled(savingEdit)
                }
                Text(preferences.text("已有附件和发送配置会保留。", "Existing attachments and send settings are kept."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 14) {
                    Button(preferences.text("编辑", "Edit"), systemImage: "pencil", action: beginEdit)
                        .frame(minHeight: 44)
                        .disabled(!canEdit)
                    Spacer(minLength: 0)
                    Button(preferences.text("取消排队", "Remove"), systemImage: "xmark", role: .destructive, action: cancel)
                        .frame(minHeight: 44)
                        .disabled(!canCancel)
                        .accessibilityLabel(preferences.text("取消排队消息", "Remove queued message"))
                }
                .buttonStyle(.borderless)
                if message.state == .failed {
                    Button(preferences.text("重试发送", "Retry send"), systemImage: "arrow.clockwise", action: retry)
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                        .disabled(!canRetry)
                    if !canRetry && modificationAllowed {
                        Text(preferences.text("当前回合结束后可重试。", "Retry when the current turn is idle."))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if message.state == .queued {
                    Button(preferences.text("改为引导", "Use as guidance"), systemImage: "arrow.turn.up.right", action: steer)
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                        .disabled(!canSteer)
                }
            }
        }
        .padding(14)
        .background(AgentTheme.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18).strokeBorder(AgentTheme.line)
        }
        .confirmationDialog(preferences.text("移除待确认消息？", "Remove this unconfirmed message?"), isPresented: $confirmingUncertainCancellation, titleVisibility: .visible) {
            Button(preferences.text("移除记录", "Remove record"), role: .destructive, action: confirmCancel)
            Button(preferences.text("保留", "Keep"), role: .cancel) { }
        } message: {
            Text(preferences.text("移除记录不会撤销可能已经发送的任务，也不会撤销已经发生的操作。", "Removing the record will not undo a task that may already have been sent or any actions it may have performed."))
        }
    }

    private var conversation: Conversation? { session.conversation(conversationID) }
    private var busy: Bool { message.state == .sending || message.state == .guiding }
    private var modificationAllowed: Bool {
        conversation?.canModify == true && session.menuBusyID != conversationID && !busy
    }
    private var canEdit: Bool { modificationAllowed && (message.state == .queued || message.state == .failed) }
    private var canCancel: Bool { modificationAllowed }
    private var canRetry: Bool { modificationAllowed && session.canInteract(conversationID) && message.state == .failed && conversation?.phase == .idle }
    private var canSteer: Bool {
        modificationAllowed && session.canInteract(conversationID) && message.state == .queued && conversation?.phase == .running
            && conversation?.queue.contains(where: { $0.state == .guiding }) == false
    }
    private var editedHasContent: Bool {
        !editedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !message.attachments.isEmpty
    }

    private func beginEdit() {
        guard canEdit else { return }
        editedText = message.text
        editing = true
    }

    private func cancelEdit() { editing = false }

    private func saveEdit() {
        guard canEdit, editedHasContent, !savingEdit else { return }
        savingEdit = true
        Task {
            let saved = await session.editQueuedMessageAndWait(conversationID: conversationID, id: message.id, text: editedText)
            savingEdit = false
            if saved { editing = false }
            else { session.toast = preferences.text("无法保存这条队列消息，请重试。", "This queued message could not be saved. Try again.") }
        }
    }

    private func cancel() {
        guard canCancel else { return }
        if message.state == .uncertain {
            confirmingUncertainCancellation = true
        } else if !session.cancelQueuedMessage(conversationID: conversationID, id: message.id) {
            session.toast = preferences.text("暂时无法取消这条消息。", "This message could not be removed right now.")
        }
    }

    private func confirmCancel() {
        guard canCancel else { return }
        if !session.cancelQueuedMessage(conversationID: conversationID, id: message.id, confirmed: true) {
            session.toast = preferences.text("暂时无法移除这条记录。", "This record could not be removed right now.")
        }
    }

    private func retry() {
        guard canRetry else { return }
        session.retryQueuedMessage(conversationID: conversationID, id: message.id)
    }

    private func steer() {
        guard canSteer else { return }
        Task { await session.steerQueuedMessage(conversationID: conversationID, id: message.id) }
    }
}
