import Foundation

enum ComposerAttachmentSubmitGate {
    static func blocks(pending: Bool, busy: Bool, hasContent: Bool) -> Bool {
        pending && !(busy && !hasContent)
    }
}
