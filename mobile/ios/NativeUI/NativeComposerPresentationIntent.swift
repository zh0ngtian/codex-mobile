import Foundation

/// ACK 与新 Workspace effect 可以按任意顺序到达；仅同时确认后允许呈现一次。
struct NativeComposerPresentationIntent {
    let commandID: String
    let previousContextID: String?
    let previousThreadID: String?
    let targetBackendID: String?
    let presentation: NativeComposerPresentation
    private(set) var acknowledged = false
    private(set) var invalidated = false
    private(set) var confirmedContextID: String?
    private var candidateContextID: String?

    init(commandID: String, previousContextID: String?, previousThreadID: String?, targetBackendID: String?, presentation: NativeComposerPresentation) {
        self.commandID = commandID
        self.previousContextID = previousContextID
        self.previousThreadID = previousThreadID
        self.targetBackendID = targetBackendID
        self.presentation = presentation
    }

    mutating func receive(_ value: NativeSnapshot) {
        guard !invalidated, confirmedContextID == nil else { return }
        if let result = value.commandResults?.last(where: { $0.id == commandID && $0.name == "thread.new" }) {
            guard result.ok else { invalidated = true; return }
            acknowledged = true
        }
        if value.contextId == previousContextID, value.threadId?.isEmpty == false, value.threadId != previousThreadID {
            invalidated = true
            return
        }
        guard let contextID = value.contextId, !contextID.isEmpty, contextID != previousContextID else { return }
        if let candidateContextID, candidateContextID != contextID {
            invalidated = true
            return
        }
        candidateContextID = contextID
        guard value.threadId?.isEmpty != false else { invalidated = true; return }
        if let targetBackendID, let backendID = value.backendId, backendID != targetBackendID {
            invalidated = true
            return
        }
        guard value.ready, !value.readOnly, value.pending != true else { return }
        guard targetBackendID == nil || targetBackendID == value.backendId else { return }
        guard acknowledged else { return }
        confirmedContextID = contextID
    }
}
