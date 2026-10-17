import SwiftUI
import UIKit

/// 将 SwiftUI 的系统字号与粗体环境显式带入可选择的 UIKit 文本。
@MainActor enum NativeSystemTypography {
    static func resolved(_ source: NSAttributedString, size: DynamicTypeSize, bold: Bool) -> NSAttributedString {
        let result = NSMutableAttributedString(attributedString: source)
        let traits = UITraitCollection { traits in
            traits.preferredContentSizeCategory = category(size)
            traits.legibilityWeight = bold ? .bold : .regular
        }
        source.enumerateAttributes(in: NSRange(location: 0, length: source.length)) { attributes, range, _ in
            guard let original = attributes[.font] as? UIFont else { return }
            let raw = attributes[.nativeFontStyle] as? String ?? original.fontDescriptor.object(forKey: .textStyle) as? String ?? UIFont.TextStyle.body.rawValue
            let style = UIFont.TextStyle(rawValue: raw)
            let preferred = UIFont.preferredFont(forTextStyle: style, compatibleWith: traits)
            // 回复基准17pt走系统字体缩放曲线；当前XS取整15pt，对齐参考正文。
            let pointSize = style == .body ? UIFontMetrics(forTextStyle: .body).scaledValue(for: 17, compatibleWith: traits).rounded() : preferred.pointSize
            let base = UIFont(descriptor: preferred.fontDescriptor, size: pointSize)
            // 系统正文描述符自行响应粗体文本；不能将所有普通文字转换为 Markdown strong。
            let strong = attributes[.nativeStrong] as? Bool ?? original.fontDescriptor.symbolicTraits.contains(.traitBold)
            let mono = attributes[.nativeMonospaced] as? Bool ?? original.fontDescriptor.symbolicTraits.contains(.traitMonoSpace)
            let italic = attributes[.nativeItalic] as? Bool ?? original.fontDescriptor.symbolicTraits.contains(.traitItalic)
            var font = mono ? UIFont.monospacedSystemFont(ofSize: base.pointSize, weight: strong ? .bold : .regular) : base
            var symbolic = font.fontDescriptor.symbolicTraits
            if strong { symbolic.insert(.traitBold) } else { symbolic.remove(.traitBold) }
            if italic { symbolic.insert(.traitItalic) }
            if let descriptor = font.fontDescriptor.withSymbolicTraits(symbolic) { font = UIFont(descriptor: descriptor, size: font.pointSize) }
            result.addAttribute(.font, value: font, range: range)
        }
        return result
    }

    private static func category(_ size: DynamicTypeSize) -> UIContentSizeCategory {
        switch size {
        case .xSmall: .extraSmall
        case .small: .small
        case .medium: .medium
        case .large: .large
        case .xLarge: .extraLarge
        case .xxLarge: .extraExtraLarge
        case .xxxLarge: .extraExtraExtraLarge
        case .accessibility1: .accessibilityMedium
        case .accessibility2: .accessibilityLarge
        case .accessibility3: .accessibilityExtraLarge
        case .accessibility4: .accessibilityExtraExtraLarge
        case .accessibility5: .accessibilityExtraExtraExtraLarge
        @unknown default: .large
        }
    }
}
