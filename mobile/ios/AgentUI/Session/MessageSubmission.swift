import Foundation

/// 本次发送的临时呈现；历史消息、远程身份与成功状态仍以真实业务为准。
struct MessageSubmission: Identifiable {
    enum State { case waiting, unconfirmed, accepted, failed }
    let id = UUID()
    let contextID: String
    let backendID: String
    let draft: ComposerDraft
    let message: ChatMessage
    let projectName: String?
    let deviceName: String
    let conversationID: UUID?
    let priorMessageIDs: Set<UUID>
    var echoMessageID: UUID?
    var commandID: String?
    var state = State.waiting
    var error: String?
    var animationFinished = false
    var awaitedConfirmation = false
}

extension AppSession {
    func prepareMessageSubmission() {
        guard presentsMessageSubmission, let context = nativeSnapshot.contextId,
              let backend = nativeSnapshot.backendId else { return }
        lastSubmittedMessageID = nil
        let references = (nativeSnapshot.quotes ?? []).map { NativeMessageReference(text: $0.text, annotation: $0.source.label(english: nativeSnapshot.locale.hasPrefix("en"))) }
        messageSubmission = MessageSubmission(contextID: context, backendID: backend, draft: composer,
            message: ChatMessage(isUser: true, text: composer.text.trimmingCharacters(in: .whitespacesAndNewlines), references: references, attachments: composer.attachments),
            projectName: composer.project.map(projectTitle), deviceName: currentDevice?.name ?? "",
            conversationID: selectedConversationID, priorMessageIDs: Set(selectedConversation?.messages.map(\.id) ?? []))
    }

    /// 入队不进入消息时间线，不能用一次发送动效改变既有排队语义。
    var presentsMessageSubmission: Bool { !nativeSnapshot.busy && nativeSnapshot.queued.isEmpty }

    private func submissionEcho(_ submission: MessageSubmission) -> UUID? {
        guard submission.conversationID == nil || submission.conversationID == selectedConversationID else { return nil }
        let candidates = (selectedConversation?.messages ?? []).filter { message in
            guard message.isUser, !submission.priorMessageIDs.contains(message.id) else { return false }
            if submission.conversationID == nil { return true }
            return message.text.trimmingCharacters(in: .whitespacesAndNewlines) == submission.message.text &&
                message.attachments.map(\.name) == submission.message.attachments.map(\.name) &&
                message.references.map(\.text) == submission.message.references.map(\.text)
        }
        // 仅绑定本次提交后的唯一完整内容回显；旧同文消息、多个候选都不能冒充受理。
        return candidates.count == 1 ? candidates[0].id : nil
    }

    func receiveMessageSubmissionResult(_ id: String, ok: Bool, error: String?, confirmed: Bool) {
        guard messageSubmission?.commandID == id, messageSubmission?.state != .accepted else { return }
        if !confirmed || nativeSnapshot.pending == true {
            messageSubmission?.state = .unconfirmed
            if nativeSnapshot.pending == true { messageSubmission?.awaitedConfirmation = true }
            // 待确认已有明确的非阻断状态，不能再经通用错误通道弹窗。
            if nativeStore?.commandError == error { nativeStore?.commandError = nil }
        } else if ok {
            messageSubmission?.state = .accepted
        } else {
            messageSubmission?.state = .failed
            messageSubmission?.error = nativeSnapshot.error ?? error ?? "消息未发送，输入已保留。"
        }
    }

    func reconcileMessageSubmission() {
        guard let submission = messageSubmission else { return }
        guard submission.contextID == nativeSnapshot.contextId, submission.backendID == nativeSnapshot.backendId else {
            messageSubmission = nil
            return
        }
        messageSubmission?.echoMessageID = submissionEcho(submission)
        if nativeSnapshot.pending == true {
            messageSubmission?.state = .unconfirmed
            messageSubmission?.awaitedConfirmation = true
        } else if submission.state != .accepted, submission.awaitedConfirmation, !submissionPending {
            // HTTP 待确认操作的迟到完成由业务快照证明；不按相同文字猜测 ACK。
            if let error = nativeSnapshot.error, !error.isEmpty {
                messageSubmission?.state = .failed
                messageSubmission?.error = error
            } else if messageSubmission?.echoMessageID != nil, !composer.hasContent {
                messageSubmission?.state = .accepted
            } else if submission.conversationID != nil, !composer.hasContent, !nativeSnapshot.queued.isEmpty {
                // 点击后业务变为运行中时可能实际入队，以业务队列承接，不伪造用户消息。
                messageSubmission?.state = .accepted
            } else if !nativeSnapshot.busy, composer.hasContent {
                messageSubmission?.state = .failed
                messageSubmission?.error = "消息未发送，输入已保留。"
            }
        }
        finishMessageSubmissionIfReady()
    }

    func messageSubmissionAnimationFinished(_ id: UUID) {
        guard messageSubmission?.id == id else { return }
        messageSubmission?.animationFinished = true
        finishMessageSubmissionIfReady()
    }

    func finishMessageSubmissionIfReady() {
        guard let submission = messageSubmission, submission.state == .accepted, submission.animationFinished else { return }
        if let echo = submission.echoMessageID { lastSubmittedMessageID = echo }
        else if submission.conversationID != nil, !composer.hasContent, !nativeSnapshot.queued.isEmpty {
            lastSubmittedMessageID = nil
        } else { return }
        messageSubmission = nil
    }

    func returnToMessageEditor() {
        guard messageSubmission?.state == .failed else { return }
        messageSubmission = nil
    }
}
