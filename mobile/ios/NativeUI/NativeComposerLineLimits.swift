import Foundation

/// 最大化时为编辑器本身预留全部预算行；普通输入继续随内容自然增长。
enum NativeComposerLineLimits {
    static func resolve(maximized: Bool, availableHeight: Double, lineHeight: Double, compact: Bool, accessibility: Bool) -> ClosedRange<Int> {
        guard maximized else { return 1...(compact ? (accessibility ? 1 : 2) : (accessibility ? 3 : 6)) }
        let lines = max(1, Int((availableHeight - 80) / max(24, lineHeight)))
        return lines...lines
    }
}
