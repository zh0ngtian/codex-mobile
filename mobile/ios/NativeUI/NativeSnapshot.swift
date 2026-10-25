import Foundation

struct NativeSnapshot: Codable {
    var quotes: [NativeMessageQuote]? = nil
    var quoteFocusToken: String? = nil
    var sidechatActive: Bool? = nil
    var sidechatParentId: String? = nil
    var sidechatActions: [NativePanelItem]? = nil
    var version = 1
    var ready = false
    var locale = "zh-CN"
    var fontScale: Double = 0.875
    var title = "Codex Mobile"
    var threadId: String? = nil
    var backendId: String? = nil
    var cwd: String? = nil
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
    var contextId: String? = nil
    var draftRevision: Int? = nil
    var commandResults: [NativeCommandResult]? = nil
    var sidebarOpen: Bool? = nil
    var navigationLoading: Bool? = nil
    var search: String? = nil
    var loading: String? = nil
    var olderTurnsState: String? = nil
    var permission: String? = nil
    var pending: Bool? = nil
    var canInterrupt: Bool? = nil
    var conversationActions: [NativePanelItem]? = nil
    var mentions: [NativeOption]? = nil
    var caretOffset: Int? = nil
    var richContent: [NativePanelItem]? = nil
    var projectName: String? = nil
    var backendName: String? = nil
    var listBackendId: String? = nil
    var modelValue: String? = nil
    var effortValue: String? = nil
    var speed: String? = nil
    var speedValue: String? = nil
    var speeds: [NativeOption]? = nil
    var permissionValue: String? = nil
    var permissions: [NativeOption]? = nil
    var contextUsage: NativeContextUsage? = nil
    var inputTokenUsage: String? = nil
    var outputTokenUsage: String? = nil
    var inputCacheHitPercent: Double? = nil
    var fiveHourRateLimit: NativeRateLimit? = nil
    var sevenDayRateLimit: NativeRateLimit? = nil
    var tokenUsage: NativeTokenUsage? = nil
    var uploadUsage: NativeUploadUsage? = nil
    var preferences: NativeSettingsPreferences? = nil
    var approvalPanel: NativePanel? = nil
}

struct NativeTokenUsage: Codable {
    var lastRequestTokens: Double? = nil
    var modelContextWindow: Double? = nil
    var inputTokens: Double? = nil
    var cachedInputTokens: Double? = nil
    var outputTokens: Double? = nil
    var totalTokens: Double? = nil
    var reasoningOutputTokens: Double? = nil
}

struct NativeUploadUsage: Codable {
    var lastRequestBytes: Double? = nil
    var turnBytes: Double? = nil
}

struct NativeSettingsPreferences: Codable {
    var language: String? = nil
    var transportMode: String? = nil
    var fontSize: String? = nil
    var notificationMode: String? = nil
    var barkConfigured: Bool? = nil
}
