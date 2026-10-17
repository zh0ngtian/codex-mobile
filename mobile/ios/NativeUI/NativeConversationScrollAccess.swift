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
    private func alignBottom(animated: Bool) {
        guard let scrollView else { return }
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
