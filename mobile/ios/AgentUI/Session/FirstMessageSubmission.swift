import Foundation

/// 首条消息的临时呈现，不注册远程会话，不把本地动效当作发送成功。
struct FirstMessageSubmission: Identifiable {
    enum State { case waiting, unconfirmed, accepted, failed }
    let id = UUID()
    let contextID: String
    let backendID: String
    let draft: ComposerDraft
    let message: ChatMessage
    let projectName: String?
    let deviceName: String
    var commandID: String?
    var state = State.waiting
    var error: String?
    var animationFinished = false
    var awaitedConfirmation = false
}

extension AppSession {
    func prepareFirstMessage() {
        guard selectedConversationID == nil, let context = nativeSnapshot.contextId,
              let backend = nativeSnapshot.backendId else { return }
        let references = (nativeSnapshot.quotes ?? []).map { NativeMessageReference(text: $0.text, annotation: $0.source.label(english: nativeSnapshot.locale.hasPrefix("en"))) }
        firstMessageSubmission = FirstMessageSubmission(contextID: context, backendID: backend, draft: composer,
            message: ChatMessage(isUser: true, text: composer.text.trimmingCharacters(in: .whitespacesAndNewlines), references: references, attachments: composer.attachments),
            projectName: composer.project.map(projectTitle), deviceName: currentDevice?.name ?? "")
    }

    func receiveFirstMessageResult(_ id: String, ok: Bool, error: String?, confirmed: Bool) {
        guard firstMessageSubmission?.commandID == id, firstMessageSubmission?.state != .accepted else { return }
        if !confirmed || nativeSnapshot.pending == true {
            firstMessageSubmission?.state = .unconfirmed
            if nativeSnapshot.pending == true { firstMessageSubmission?.awaitedConfirmation = true }
            // 待确认已有明确的非阻断状态，不能再经通用错误通道弹窗。
            if nativeStore?.commandError == error { nativeStore?.commandError = nil }
        } else if ok {
            firstMessageSubmission?.state = .accepted
        } else {
            firstMessageSubmission?.state = .failed
            firstMessageSubmission?.error = nativeSnapshot.error ?? error ?? "消息未发送，输入已保留。"
        }
    }

    func reconcileFirstMessage() {
        guard let first = firstMessageSubmission else { return }
        guard first.contextID == nativeSnapshot.contextId, first.backendID == nativeSnapshot.backendId else {
            firstMessageSubmission = nil
            return
        }
        if nativeSnapshot.pending == true {
            firstMessageSubmission?.state = .unconfirmed
            firstMessageSubmission?.awaitedConfirmation = true
        } else if first.state != .accepted, first.awaitedConfirmation, !submissionPending {
            // HTTP 待确认操作的迟到完成由业务快照证明；不按相同文字猜测 ACK。
            if let error = nativeSnapshot.error, !error.isEmpty {
                firstMessageSubmission?.state = .failed
                firstMessageSubmission?.error = error
            } else if selectedConversationID != nil, !composer.hasContent, nativeSnapshot.messages.contains(where: { $0.role == "user" }) {
                firstMessageSubmission?.state = .accepted
            } else if !nativeSnapshot.busy, composer.hasContent {
                firstMessageSubmission?.state = .failed
                firstMessageSubmission?.error = "消息未发送，输入已保留。"
            }
        }
        finishFirstMessageIfReady()
    }

    func firstMessageAnimationFinished(_ id: UUID) {
        guard firstMessageSubmission?.id == id else { return }
        firstMessageSubmission?.animationFinished = true
        finishFirstMessageIfReady()
    }

    func finishFirstMessageIfReady() {
        guard let first = firstMessageSubmission, first.state == .accepted, first.animationFinished,
              selectedConversation?.messages.contains(where: \.isUser) == true else { return }
        firstMessageSubmission = nil
    }

    func returnToFirstMessageEditor() {
        guard firstMessageSubmission?.state == .failed else { return }
        firstMessageSubmission = nil
    }
}
