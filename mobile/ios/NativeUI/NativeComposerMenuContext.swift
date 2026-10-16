import Foundation

/// 菜单创建时捕获所属会话；系统菜单关闭动画中的回调不能改动后来切入的会话。
struct NativeComposerMenuContext {
    let contextID: String?

    func allowsExecution(contextID: String?, editable: Bool, sidebarOpen: Bool) -> Bool {
        self.contextID == contextID && editable && !sidebarOpen
    }
}
