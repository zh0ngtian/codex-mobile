import Foundation

/// 只有显式、单调递增的网页请求改变焦点；原生观察的同版本echo不能收起键盘。
struct NativeWebEditorFocusState {
    private var lastRevision: Int?
    mutating func request(revision: Int?, focused: Bool?, resuming: Bool) -> Bool? {
        guard let revision, let focused, revision >= 0 else { return nil }
        if lastRevision == nil || revision > lastRevision! {
            lastRevision = revision
            return focused
        }
        if revision == lastRevision, resuming, focused { return true }
        return nil
    }
}

struct NativeWebEditorRect: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    func isValid(viewportWidth: Double?, viewportHeight: Double?) -> Bool {
        guard let viewportWidth, let viewportHeight,
              [x, y, width, height, viewportWidth, viewportHeight].allSatisfy({ $0.isFinite }),
              x >= 0, y >= 0, width > 0, height > 0, viewportWidth > 0, viewportHeight > 0,
              viewportWidth <= 100_000, viewportHeight <= 100_000 else { return false }
        return x + width <= viewportWidth + 1 && y + height <= viewportHeight + 1
    }
}

/// 网页拥有工具栏、菜单及整体布局；原生只覆盖可信的文字编辑矩形。
struct NativeWebComposerPresentation: Codable {
    var contextId: String
    var visible: Bool
    var blocked: Bool
    private(set) var bodyFontSize: Double? = nil
    var rect: NativeWebEditorRect? = nil
    var viewportWidth: Double? = nil
    var viewportHeight: Double? = nil
    var selectionStart: Int? = nil
    var selectionEnd: Int? = nil
    var focused: Bool? = nil
    var focusRevision: Int? = nil
    var paddingTop: Double? = nil
    var paddingRight: Double? = nil
    var paddingBottom: Double? = nil
    var paddingLeft: Double? = nil
    var fontSize: Double? = nil
    var lineHeight: Double? = nil

    init(contextId: String, visible: Bool, blocked: Bool, bodyFontSize: Double? = nil) {
        self.contextId = contextId; self.visible = visible; self.blocked = blocked
        self.bodyFontSize = Self.validMetric(bodyFontSize, maximum: 64, positive: true)
    }
    private enum CodingKeys: String, CodingKey {
        case contextId, visible, blocked, bodyFontSize, rect, viewportWidth, viewportHeight, selectionStart, selectionEnd, focused, focusRevision
        case paddingTop, paddingRight, paddingBottom, paddingLeft, fontSize, lineHeight
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try values.decode(String.self, forKey: .contextId)
        visible = try values.decode(Bool.self, forKey: .visible)
        blocked = try values.decode(Bool.self, forKey: .blocked)
        bodyFontSize = Self.validMetric(try? values.decode(Double.self, forKey: .bodyFontSize), maximum: 64, positive: true)
        viewportWidth = Self.validMetric(try? values.decode(Double.self, forKey: .viewportWidth), maximum: 100_000, positive: true)
        viewportHeight = Self.validMetric(try? values.decode(Double.self, forKey: .viewportHeight), maximum: 100_000, positive: true)
        if let candidate = try? values.decode(NativeWebEditorRect.self, forKey: .rect), candidate.isValid(viewportWidth: viewportWidth, viewportHeight: viewportHeight) { rect = candidate }
        selectionStart = try? values.decode(Int.self, forKey: .selectionStart)
        selectionEnd = try? values.decode(Int.self, forKey: .selectionEnd)
        if let start = selectionStart, let end = selectionEnd, start >= 0, end >= start {} else { selectionStart = nil; selectionEnd = nil }
        focused = try? values.decode(Bool.self, forKey: .focused)
        if let revision = try? values.decode(Int.self, forKey: .focusRevision), revision >= 0 { focusRevision = revision }
        paddingTop = Self.validMetric(try? values.decode(Double.self, forKey: .paddingTop))
        paddingRight = Self.validMetric(try? values.decode(Double.self, forKey: .paddingRight))
        paddingBottom = Self.validMetric(try? values.decode(Double.self, forKey: .paddingBottom))
        paddingLeft = Self.validMetric(try? values.decode(Double.self, forKey: .paddingLeft))
        fontSize = Self.validMetric(try? values.decode(Double.self, forKey: .fontSize), positive: true)
        lineHeight = Self.validMetric(try? values.decode(Double.self, forKey: .lineHeight), positive: true)
    }
    private static func validMetric(_ value: Double?, maximum: Double = 128, positive: Bool = false) -> Double? {
        guard let value, value.isFinite, positive ? value > 0 : value >= 0, value <= maximum else { return nil }
        return value
    }
    func isVisible(composerEnabled: Bool, nativeEnabled: Bool, recovery: Bool, ready: Bool, sidebarOpen: Bool, contextId: String?) -> Bool {
        composerEnabled && !nativeEnabled && !recovery && ready && !sidebarOpen && self.contextId == contextId && visible && !blocked
    }
}
