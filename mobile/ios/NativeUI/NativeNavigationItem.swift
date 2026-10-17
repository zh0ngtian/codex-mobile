import Foundation

struct NativeNavigationItem: Codable, Identifiable {
    var id: String
    var title: String
    var subtitle: String? = nil
    var badge: String? = nil
    var selected: Bool? = nil
    var command: NativeCommand? = nil
    var actions: [NativePanelItem]? = nil
    var backendId: String? = nil
    var threadId: String? = nil
    var cwd: String? = nil
    var isPinned: Bool? = nil
    var isUnread: Bool? = nil
    var running: Bool? = nil
    var timestamp: Double? = nil
    var inputText: String? = nil
    var queueState: String? = nil
    var attachmentCount: Int? = nil
    var revision: Int? = nil
    var error: String? = nil
    var attachments: [NativeAttachment]? = nil
    var configuration: NativeQueueConfiguration? = nil
}

struct NativeQueueConfiguration: Codable {
    var model: String? = nil
    var effort: String? = nil
    var serviceTier: String? = nil
    var permission: String? = nil
}
