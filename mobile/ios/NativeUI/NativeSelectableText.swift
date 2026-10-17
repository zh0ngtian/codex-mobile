import SwiftUI
import UIKit

/// 只读的系统文本视图，保留原生选择手柄和复制菜单。
struct NativeSelectableText: UIViewRepresentable {
    let text: NSAttributedString
    var identifier = "assistant.selectable"
    var openLink: (URL) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(openLink: openLink) }

    func makeUIView(context: Context) -> UITextView {
        let storage = NSTextStorage()
        let layout = NativeDottedTextLayoutManager()
        let container = NSTextContainer(size: .zero)
        container.lineFragmentPadding = 0
        container.widthTracksTextView = false
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let view = UITextView(frame: .zero, textContainer: container)
        view.backgroundColor = .clear
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.adjustsFontForContentSizeCategory = true
        view.tintColor = .label
        view.dataDetectorTypes = []
        view.delegate = context.coordinator
        view.linkTextAttributes = [.foregroundColor: UIColor.label,
                                   .underlineStyle: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.openLink = openLink
        view.accessibilityIdentifier = identifier
        guard !view.attributedText.isEqual(to: text) else { return }
        let selection = view.selectedRange
        view.attributedText = text
        if selection.length > 0, NSMaxRange(selection) <= text.length { view.selectedRange = selection }
        view.invalidateIntrinsicContentSize()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let natural = text.boundingRect(with: CGSize(width: 100_000, height: 100_000),
                                        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        let width = max(1, proposal.width ?? ceil(natural.width))
        uiView.textContainer.size = CGSize(width: width, height: .greatestFiniteMagnitude)
        uiView.layoutManager.ensureLayout(for: uiView.textContainer)
        let used = uiView.layoutManager.usedRect(for: uiView.textContainer)
        return CGSize(width: width, height: ceil(used.maxY))
    }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var openLink: (URL) -> Void
        init(openLink: @escaping (URL) -> Void) { self.openLink = openLink }
        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case .link(let url) = textItem.content else { return defaultAction }
            return UIAction { [weak self] _ in self?.openLink(url) }
        }
    }
}

/// TextKit 的 patternDot 不保证圆形端点，因此直接绘制独立圆点。
final class NativeDottedTextLayoutManager: NSLayoutManager {
    override func drawUnderline(forGlyphRange glyphRange: NSRange, underlineType: NSUnderlineStyle,
                                baselineOffset: CGFloat, lineFragmentRect lineRect: CGRect,
                                lineFragmentGlyphRange lineGlyphRange: NSRange, containerOrigin: CGPoint) {
        guard underlineType.contains(.patternDot), glyphRange.length > 0,
              let container = textContainer(forGlyphAt: glyphRange.location, effectiveRange: nil),
              let context = UIGraphicsGetCurrentContext(), let storage = textStorage else {
            super.drawUnderline(forGlyphRange: glyphRange, underlineType: underlineType, baselineOffset: baselineOffset,
                                lineFragmentRect: lineRect, lineFragmentGlyphRange: lineGlyphRange, containerOrigin: containerOrigin)
            return
        }
        let character = characterIndexForGlyph(at: glyphRange.location)
        let font = storage.attribute(.font, at: character, effectiveRange: nil) as? UIFont ?? .preferredFont(forTextStyle: .body)
        let color = storage.attribute(.foregroundColor, at: character, effectiveRange: nil) as? UIColor ?? .label
        let bounds = boundingRect(forGlyphRange: glyphRange, in: container)
        let diameter = max(1, font.pointSize / 17)
        let y = containerOrigin.y + lineRect.minY + location(forGlyphAt: glyphRange.location).y + 2
        context.saveGState()
        color.setFill()
        var x = containerOrigin.x + bounds.minX + diameter / 2
        while x <= containerOrigin.x + bounds.maxX - diameter / 2 {
            context.fillEllipse(in: CGRect(x: x - diameter / 2, y: y, width: diameter, height: diameter))
            x += diameter * 3
        }
        context.restoreGState()
    }

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.nativeQuoteRule, in: characters) { value, range, _ in
            guard value as? Bool == true else { return }
            let glyphs = self.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            self.enumerateLineFragments(forGlyphRange: glyphs) { rect, used, _, _, _ in
                UIColor.secondaryLabel.withAlphaComponent(0.3).setFill()
                UIBezierPath(roundedRect: CGRect(x: origin.x + rect.minX, y: origin.y + rect.minY,
                                                width: 3, height: used.height), cornerRadius: 1.5).fill()
            }
        }
    }
}
