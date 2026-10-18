import Foundation

extension AppSession {
    /// 选择器开启时的作用域必须显式保留，不能把迟到的文件交给后来切入的草稿。
    func importAttachmentsAndWait(_ items: [AttachmentItem], contextID: String) async -> Bool {
        guard nativeSnapshot.contextId == contextID, nativeStore?.composerCanEdit == true, historyEdit == nil else { return false }
        let payload = attachmentPayload(items)
        guard !payload.isEmpty, payload.count == items.count else {
            toast = nativeStore?.label("附件内容不完整，请重新选择。", "Attachment data is incomplete. Choose again.")
            return false
        }
        return await request("attachment.import", ["items": .array(payload), "contextId": .string(contextID)])
    }
}
