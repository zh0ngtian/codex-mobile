import Foundation

/// 只有真实挂载的网页会话才能展示输入栏，不能从业务ready推断页面可见性。
struct NativeWebComposerPresentation: Codable {
    var contextId: String
    var visible: Bool
    var blocked: Bool
    /// 未缩放的网页正文基准；缺省继续使用完整原生正文的 14.5pt。
    private(set) var bodyFontSize: Double? = nil

    init(contextId: String, visible: Bool, blocked: Bool, bodyFontSize: Double? = nil) {
        self.contextId = contextId
        self.visible = visible
        self.blocked = blocked
        self.bodyFontSize = Self.validBodyFontSize(bodyFontSize)
    }

    private enum CodingKeys: String, CodingKey { case contextId, visible, blocked, bodyFontSize }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try values.decode(String.self, forKey: .contextId)
        visible = try values.decode(Bool.self, forKey: .visible)
        blocked = try values.decode(Bool.self, forKey: .blocked)
        bodyFontSize = Self.validBodyFontSize(try? values.decode(Double.self, forKey: .bodyFontSize))
    }

    private static func validBodyFontSize(_ value: Double?) -> Double? {
        // 基准不含 Dynamic Type；拒绝错误类型、非有限值及超出正文用途的值。
        guard let value, value.isFinite, value > 0, value <= 64 else { return nil }
        return value
    }

    func isVisible(composerEnabled: Bool, nativeEnabled: Bool, recovery: Bool, ready: Bool, sidebarOpen: Bool, contextId: String?) -> Bool {
        composerEnabled && !nativeEnabled && !recovery && ready && !sidebarOpen && self.contextId == contextId && visible && !blocked
    }
}
