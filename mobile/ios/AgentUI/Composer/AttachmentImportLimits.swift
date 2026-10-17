import Foundation

enum AttachmentImportLimits {
    static let perFileBytes = 20 * 1_024 * 1_024
    static let totalBytes = 40 * 1_024 * 1_024

    static func validate(byteCount: Int, availableBytes: Int) throws {
        if byteCount > perFileBytes { throw AttachmentImportError.fileLimit }
        if byteCount > max(0, availableBytes) { throw AttachmentImportError.batchLimit }
    }

    static func retainedBytes(in items: [AttachmentItem]) -> Int {
        items.reduce(0) { total, item in
            min(totalBytes, total + min(item.data?.count ?? 0, totalBytes))
        }
    }
}
