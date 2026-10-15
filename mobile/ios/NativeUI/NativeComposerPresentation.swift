import Foundation

/// 仅描述原生界面呈现，不增加任何业务 RPC。
enum NativeComposerPresentation: Equatable {
    case focus
    case attachments
    case photos
    case files
}
