import Foundation

/// 只有真实挂载的网页会话才能展示输入栏，不能从业务ready推断页面可见性。
struct NativeWebComposerPresentation: Codable {
    var contextId: String
    var visible: Bool
    var blocked: Bool

    func isVisible(composerEnabled: Bool, nativeEnabled: Bool, recovery: Bool, ready: Bool, sidebarOpen: Bool, contextId: String?) -> Bool {
        composerEnabled && !nativeEnabled && !recovery && ready && !sidebarOpen && self.contextId == contextId && visible && !blocked
    }
}
