import Foundation

/// 仅描述现有附件入口，不拥有选择器、草稿或附件业务状态。
enum NativeComposerAttachmentAction: CaseIterable {
    case photos, files, location

    var symbol: String {
        switch self {
        case .photos: "photo"
        case .files: "paperclip"
        case .location: "location"
        }
    }

    var command: NativeCommand {
        switch self {
        case .photos: NativeCommand(name: "attachment.pick", params: ["kind": .string("photos")])
        case .files: NativeCommand(name: "attachment.pick", params: ["kind": .string("files")])
        case .location: NativeCommand(name: "location.insert")
        }
    }

    func title(chinese: Bool) -> String {
        switch self {
        case .photos: chinese ? "照片" : "Photos"
        case .files: chinese ? "文件" : "Files"
        case .location: chinese ? "当前位置" : "Current Location"
        }
    }
}
