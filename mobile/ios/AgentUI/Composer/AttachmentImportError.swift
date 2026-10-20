import Foundation

enum AttachmentImportError: Error, Equatable {
    case missingData, unreadableImage, fileLimit, batchLimit, fileSizeUnavailable

    static func message(for error: Error, isEnglish: Bool) -> String {
        if let error = error as? AttachmentImportError {
            switch error {
            case .fileLimit:
                return isEnglish ? "This file exceeds the 20 MiB per-file memory limit. Remove it and choose a smaller file." : "此文件超出单文件 20 MiB 内存上限，请移除并选择较小的文件。"
            case .batchLimit:
                return isEnglish ? "This exceeds the 40 MiB total attachment memory limit, including existing input attachments. Remove some attachments and choose again." : "已超出附件合计 40 MiB 内存上限（包含输入框已有附件），请移除部分附件后重新选择。"
            case .fileSizeUnavailable:
                return isEnglish ? "Could not check this file’s size safely. Remove it and choose another file." : "无法安全确认此文件的大小，请移除并选择另一文件。"
            case .missingData, .unreadableImage: break
            }
        }
        if let error = error as? AttachmentImportError, error == .unreadableImage {
            return isEnglish ? "This image could not be read. Remove it and choose another image." : "无法读取此图片，请移除后选择另一张图片。"
        }
        if error is AttachmentImportError {
            return isEnglish ? "No attachment data was found. Remove it and choose again." : "没有找到附件数据，请移除后重新选择。"
        }
        return isEnglish ? "Could not read this attachment. Your input is preserved; remove it and choose again." : "无法读取此附件。已保留现有输入，请移除后重新选择。"
    }
}
