import UIKit

/// UI/UX Pro Max 的视觉规范在 UIKit 中使用语义颜色和系统文字度量落地。
enum NativeConversationAppearance {
    static let readingWidth: CGFloat = 720
    static let readingInset: CGFloat = 20
    static let touchTarget: CGFloat = 44
    static let inputCorner: CGFloat = 28
    static let messageCorner: CGFloat = 20
    static let codeCorner: CGFloat = 12
    static let secondaryText = UIColor { traits in
        UIColor(white: traits.userInterfaceStyle == .dark ? 0.68 : 0.36, alpha: 1)
    }

    static func body(_ size: CGFloat, traits: UITraitCollection, weight: UIFont.Weight = .regular) -> UIFont {
        scaled(min(max(size + 1, 15), 25), style: .body, traits: traits, weight: weight)
    }

    static func scaled(_ size: CGFloat, style: UIFont.TextStyle, traits: UITraitCollection,
                       weight: UIFont.Weight = .regular, monospaced: Bool = false) -> UIFont {
        let base = monospaced ? UIFont.monospacedSystemFont(ofSize: size, weight: weight) : UIFont.systemFont(ofSize: size, weight: weight)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base, compatibleWith: traits)
    }

    static func contentWidth(in viewport: CGFloat) -> CGFloat {
        min(max(viewport - readingInset * 2, 0), readingWidth)
    }
}
