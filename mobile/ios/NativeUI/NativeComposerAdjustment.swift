import Foundation

/// 调节面板只保存呈现状态；草稿与选项仍由原有 store 和业务桥拥有。
struct NativeComposerAdjustment: Identifiable {
    let kind: NativeComposerAdjustmentKind
    let contextID: String?
    let wasFocused: Bool
    var id: String { kind.rawValue }

    func restoredFocus(contextID: String?, editable: Bool, sidebarOpen: Bool) -> Bool? {
        guard contextID == self.contextID, editable, !sidebarOpen else { return nil }
        return wasFocused
    }
}
