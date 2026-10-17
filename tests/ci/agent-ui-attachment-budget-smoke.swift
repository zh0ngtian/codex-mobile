import Foundation

@main struct AgentAttachmentBudgetSmoke {
    static func main() throws {
        let mib = 1_024 * 1_024
        let uploaded = AttachmentItem(name: "已导入文件.bin", byteCount: 30 * mib)
        precondition(AttachmentImportLimits.retainedBytes(in: [uploaded]) == 30 * mib, "真实已导入附件的size不能按0计算")
        let available = AttachmentImportLimits.totalBytes - AttachmentImportLimits.retainedBytes(in: [uploaded])
        try AttachmentImportLimits.validate(byteCount: 10 * mib, availableBytes: available)
        do {
            try AttachmentImportLimits.validate(byteCount: 11 * mib, availableBytes: available)
            preconditionFailure("已有30MiB时，不可再添加11MiB")
        } catch { precondition(error as? AttachmentImportError == .batchLimit) }
        let both = AttachmentItem(name: "已缓存在本机.txt", data: Data(repeating: 0, count: 1_024), byteCount: 1_024)
        precondition(AttachmentImportLimits.retainedBytes(in: [both]) == 1_024, "相同附件的data和size不能重复累计")
        let large = AttachmentItem(name: "large", byteCount: Int.max)
        let negative = AttachmentItem(name: "negative", byteCount: -100)
        precondition(AttachmentImportLimits.retainedBytes(in: [large, uploaded]) == AttachmentImportLimits.totalBytes)
        precondition(AttachmentImportLimits.retainedBytes(in: [negative, both]) == 1_024)
        print("Agent attachment budget smoke passed")
    }
}
