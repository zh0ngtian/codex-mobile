import UIKit

/// 行内代码在当前行剩余宽度内按字符断行，普通正文仍沿用系统的单词边界。
class NativeInlineCodeLayoutManager: NSLayoutManager, NSLayoutManagerDelegate {
    private var wrapsInlineCode = false

    override init() {
        super.init()
        delegate = self
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        delegate = self
    }

    func layoutManager(_ layoutManager: NSLayoutManager, shouldBreakLineByWordBeforeCharacterAt index: Int) -> Bool {
        if let storage = textStorage, index < storage.length,
           storage.attribute(.nativeInlineCode, at: index, effectiveRange: nil) as? Bool == true {
            wrapsInlineCode = true
        }
        // TextKit 会向前寻找单词边界；拒绝本行更早的边界，使代码按实际可用宽度断行。
        return !wrapsInlineCode
    }

    func layoutManager(_ layoutManager: NSLayoutManager, shouldSetLineFragmentRect lineFragmentRect: UnsafeMutablePointer<CGRect>,
                       lineFragmentUsedRect: UnsafeMutablePointer<CGRect>, baselineOffset: UnsafeMutablePointer<CGFloat>,
                       in textContainer: NSTextContainer, forGlyphRange glyphRange: NSRange) -> Bool {
        wrapsInlineCode = false
        return false
    }

    func layoutManagerDidInvalidateLayout(_ sender: NSLayoutManager) {
        wrapsInlineCode = false
    }
}
