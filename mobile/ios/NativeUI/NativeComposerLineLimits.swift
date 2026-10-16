import Foundation

/// 编辑器从一行按内容自然增长，超出当前宿主预算后在控件内部滚动。
enum NativeComposerLineLimits {
    static func resolve(availableHeight: Double, lineHeight: Double, compact: Bool, accessibility: Bool) -> ClosedRange<Int> {
        let preferred = compact ? (accessibility ? 1 : 2) : (accessibility ? 3 : 6)
        let safeHeight = availableHeight.isFinite ? max(0, availableHeight) : 0
        let safeLine = lineHeight.isFinite && lineHeight > 0 ? max(1, lineHeight) : 24
        // 先限制到自然行数上限，避免极大有限高度转换成 Int 时溢出。
        let budget = Int(min(Double(preferred), max(0, safeHeight - 80) / safeLine))
        return 1...max(1, budget)
    }
}
