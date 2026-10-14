import Foundation

struct NativeSnapshot: Codable {
    var version = 1
    var ready = false
    var locale = "zh-CN"
    var fontScale: Double = 1
    var title = "Codex Mobile"
    var threadId: String? = nil
    var backendId: String? = nil
    var connection = "disconnected"
    var busy = false
    var draft = ""
    var canSend = false
    var readOnly = false
    var backends: [NativeBackend] = []
    var groups: [NativeGroup] = []
    var messages: [NativeMessage] = []
    var attachments: [NativeAttachment] = []
    var queued: [NativeNavigationItem] = []
    var approvalCount = 0
    var panel: NativePanel? = nil
    var error: String? = nil
    var badge: String? = nil
    var model = "模型"
    var effort = "推理强度"
    var models: [NativeOption] = []
    var efforts: [NativeOption] = []
}
