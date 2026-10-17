import SwiftUI
import UIKit

/// 负责底部跟随；历史条目仍由既有稳定ID锚点恢复。
@MainActor final class NativeConversationScrollAccess {
    private weak var scrollView: UIScrollView?
    private var contentSizeObservation: NSKeyValueObservation?
    private var following = false

    func attach(_ view: UIScrollView) {
        guard scrollView !== view else { return }
        scrollView = view
        contentSizeObservation = view.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self, self.following else { return }
                self.alignBottom(animated: false)
            }
        }
    }
    func scrollToBottom() { following = true; alignBottom(animated: true) }
    func stopFollowing() { following = false }
    // 只有语义定位已落到底部后才恢复高度回填跟随，不发起新的坐标跳转。
    func resumeFollowing() { following = true }
    private func alignBottom(animated: Bool) {
        guard let scrollView else { return }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") {
            NSLog("CODEX_SCROLL before offset=%f content=%f viewport=%f animated=%d", scrollView.contentOffset.y, scrollView.contentSize.height, scrollView.bounds.height, animated ? 1 : 0)
        }
        #endif
        scrollView.layoutIfNeeded()
        let y = max(-scrollView.adjustedContentInset.top,
                    scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom)
        if abs(scrollView.contentOffset.y - y) > 0.5 {
            scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: y), animated: animated)
        }
    }
}

struct NativeConversationScrollResolver: UIViewRepresentable {
    let access: NativeConversationScrollAccess
    func makeUIView(context: Context) -> ResolverView { ResolverView() }
    func updateUIView(_ view: ResolverView, context: Context) { view.access = access; view.resolve() }

    final class ResolverView: UIView {
        weak var access: NativeConversationScrollAccess?
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            resolve()
            DispatchQueue.main.async { [weak self] in self?.resolve() }
        }
        func resolve() {
            var ancestor = superview
            while let view = ancestor {
                if let scrollView = view as? UIScrollView { access?.attach(scrollView); return }
                ancestor = view.superview
            }
        }
    }
}
