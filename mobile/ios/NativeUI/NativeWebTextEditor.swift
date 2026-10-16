import UIKit
import WebKit

/// 常驻文字编辑器；网页 textarea 决定它唯一可命中的矩形，按钮和弹层都留在网页。
@MainActor
final class NativeWebTextEditor: NSObject, UITextViewDelegate {
    private let store: NativeUIStore
    private let reportState: (String, Bool, Int, Int) -> Void
    private let input = UITextView()
    private let placeholder = UILabel()
    private var contextID: String?
    private var synchronizing = false
    private var canEdit = false
    private var focusState = NativeWebEditorFocusState()
    private var pendingSelection = false
    private var selectionRevision = -1

    init(store: NativeUIStore, reportState: @escaping (String, Bool, Int, Int) -> Void) {
        self.store = store; self.reportState = reportState
        super.init()
        input.delegate = self
        input.backgroundColor = .clear
        // 网页输入栏固定浅底；仅这个混合编辑器使用浅色trait，placeholder和typingAttributes随之解析。
        input.overrideUserInterfaceStyle = .light
        input.textContainer.lineFragmentPadding = 0
        input.clipsToBounds = true
        input.accessibilityIdentifier = "native-composer-input"
        input.keyboardDismissMode = .interactive
        input.contentInsetAdjustmentBehavior = .never
        input.isHidden = true
        placeholder.isUserInteractionEnabled = false
        placeholder.textColor = .placeholderText
        input.addSubview(placeholder)
    }

    func update(in webView: WKWebView, active: Bool) {
        guard active, store.webComposerVisible, store.composerCanEdit, let presentation = store.snapshot.webComposer else { hide(); return }
        guard let rect = presentation.rect,
              rect.isValid(viewportWidth: presentation.viewportWidth, viewportHeight: presentation.viewportHeight),
              let viewportWidth = presentation.viewportWidth, webView.bounds.width > 0 else { suspendGeometry(contextID: presentation.contextId); return }
        let scale = webView.bounds.width / viewportWidth
        let frame = CGRect(x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale)
        // 几何只允许落在当前业务 WebView 内，不向工具栏或遮罩扩张命中区域。
        guard frame.minX >= 0, frame.minY >= 0, frame.maxX <= webView.bounds.width + 1, frame.maxY <= webView.bounds.height + 1 else { suspendGeometry(contextID: presentation.contextId); return }
        synchronizing = true
        defer { synchronizing = false }
        if contextID != presentation.contextId {
            input.resignFirstResponder()
            contextID = presentation.contextId
            input.text = ""
            focusState = NativeWebEditorFocusState()
            pendingSelection = false
            selectionRevision = -1
        }
        if input.superview !== webView { input.removeFromSuperview(); webView.addSubview(input) }
        let resuming = input.isHidden
        canEdit = true
        input.isHidden = false
        input.alpha = 1
        input.isUserInteractionEnabled = true
        input.isEditable = true
        input.frame = frame
        let size = (presentation.fontSize ?? ((presentation.bodyFontSize ?? 16) * store.snapshot.fontScale)) * scale
        let font = UIFont.systemFont(ofSize: size)
        if input.font?.pointSize != font.pointSize { input.font = font }
        input.textColor = .label
        input.tintColor = UIColor(red: 1, green: 0.286, blue: 0.675, alpha: 1)
        input.textContainerInset = UIEdgeInsets(top: (presentation.paddingTop ?? 0) * scale, left: (presentation.paddingLeft ?? 0) * scale,
            bottom: (presentation.paddingBottom ?? 0) * scale, right: (presentation.paddingRight ?? 0) * scale)
        let paragraph = NSMutableParagraphStyle()
        let lineHeight = (presentation.lineHeight ?? Double(font.lineHeight)) * scale
        paragraph.minimumLineHeight = max(font.lineHeight, lineHeight)
        paragraph.maximumLineHeight = max(font.lineHeight, lineHeight)
        input.typingAttributes = [.font: font, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
        let focusRequest = focusState.request(revision: presentation.focusRevision, focused: presentation.focused, resuming: resuming)
        if focusRequest != nil { pendingSelection = true }
        // Web echo 不重设输入或选区；中文 marked text 在整个输入周期保留同一 UITextView。
        if input.markedTextRange == nil {
            if input.text != store.draft { input.text = store.draft }
            if pendingSelection || selectionRevision != store.selectionRevision {
                let length = input.text.utf16.count
                let start = min(length, max(0, pendingSelection ? presentation.selectionStart ?? store.caretOffset : store.caretOffset))
                let end = min(length, max(start, pendingSelection ? presentation.selectionEnd ?? start : start))
                input.selectedRange = NSRange(location: start, length: end - start)
                selectionRevision = store.selectionRevision
                pendingSelection = false
            }
        }
        if focusRequest == true && !input.isFirstResponder { input.becomeFirstResponder() }
        if focusRequest == false && input.isFirstResponder { input.resignFirstResponder() }
        placeholder.text = store.label("向 Codex 提问", "Ask Codex")
        placeholder.font = font
        placeholder.frame = CGRect(x: input.textContainerInset.left, y: input.textContainerInset.top,
            width: max(0, frame.width - input.textContainerInset.left - input.textContainerInset.right), height: font.lineHeight)
        placeholder.isHidden = !input.text.isEmpty
        input.accessibilityLabel = placeholder.text
    }

    private func suspendGeometry(contextID: String) {
        // 键盘先缩小WK bounds、JS后发布resize矩形；此过渡不能resign，否则动画会反向并丢字。
        // 同context的现有键盘输入继续走原版本门禁，旧矩形完全透明且不参与命中。
        guard self.contextID == contextID, current, input.isFirstResponder else { hide(); return }
        // alpha=0 的 UIView 不参与 UIKit 命中；不能切换isUserInteractionEnabled，后者会让UITextView失焦。
        input.alpha = 0
    }

    func hide() {
        synchronizing = true
        canEdit = false
        input.resignFirstResponder()
        input.isEditable = false
        input.isHidden = true
        synchronizing = false
    }
    private var current: Bool { canEdit && store.composerCanEdit && store.webComposerVisible && contextID == store.snapshot.contextId }
    func textViewShouldBeginEditing(_ textView: UITextView) -> Bool { current }
    func textViewDidBeginEditing(_ textView: UITextView) { publishState() }
    func textViewDidEndEditing(_ textView: UITextView) { publishState() }
    func textViewDidChange(_ textView: UITextView) { changed() }
    func textViewDidChangeSelection(_ textView: UITextView) { changed() }
    private func changed() {
        guard !synchronizing, current, let contextID else { return }
        placeholder.isHidden = !input.text.isEmpty
        store.updateWebDraft(input.text, caret: input.selectedRange.location, contextID: contextID)
        publishState()
    }
    private func publishState() {
        guard !synchronizing, current, let contextID else { return }
        reportState(contextID, input.isFirstResponder, input.selectedRange.location, NSMaxRange(input.selectedRange))
    }
}
