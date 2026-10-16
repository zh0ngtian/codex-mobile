import Foundation

/// 使用宿主提案为一行编辑、工具栏和可滚动辅助区分配空间，不读取输入栏自身高度。
struct NativeComposerLayoutBudget {
    let outerTopInset: Double
    let outerBottomInset: Double
    let supplementarySpacing: Double
    let editorTopInset: Double
    let editorBottomInset: Double
    let editorMinimumHeight: Double
    let supplementaryMaximumHeight: Double
    var outerHeight: Double { outerTopInset + outerBottomInset }
    var editorChromeHeight: Double { editorTopInset + editorBottomInset }

    static func resolve(availableHeight: Double, lineHeight: Double, toolbarHeight: Double,
                        expanded: Bool, focused: Bool, compact: Bool,
                        hasSupplementaryContent: Bool) -> Self {
        let height = availableHeight.isFinite ? max(0, availableHeight) : 0
        let line = lineHeight.isFinite && lineHeight > 0 ? lineHeight : 24
        let toolbar = toolbarHeight.isFinite && toolbarHeight > 0 ? max(44, toolbarHeight) : 44
        let outerTop: Double = compact ? 4 : 8
        let outerBottom: Double = compact ? 4 : (focused ? 12 : 6)
        let gap: Double = hasSupplementaryContent ? (compact ? 4 : 12) : 0
        let editorTop: Double = expanded ? (compact ? 4 : 17) : 14
        // 模型文字会撑高整行，必须为完整工具栏、4pt 底距和 1pt 舍入净空留位。
        let toolbarClearance = ceil(toolbar) + 4 + 1
        let editorBottom: Double = expanded ? max(compact ? 48 : 58, toolbarClearance) : 14
        let minimum = max(expanded ? (compact ? 88 : 98) : 48, line + editorTop + editorBottom)
        return Self(outerTopInset: outerTop, outerBottomInset: outerBottom, supplementarySpacing: gap,
                    editorTopInset: editorTop, editorBottomInset: editorBottom, editorMinimumHeight: minimum,
                    supplementaryMaximumHeight: hasSupplementaryContent ? max(0, height - minimum - outerTop - outerBottom - gap) : 0)
    }
}
