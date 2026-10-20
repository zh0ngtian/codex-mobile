import SwiftUI
import UIKit

/// 显式底部定位由ScrollViewReader的末尾ID执行；UIKit观察高度回填，不写估算坐标。
@MainActor final class NativeConversationScrollAccess {
    private weak var scrollView: UIScrollView?
    private weak var resolver: NativeConversationScrollResolver.ResolverView?
    private var contentSizeObservation: NSKeyValueObservation?
    private var following = false
    private var requestQueued = false
    private var needsAnchor = false

    func attach(_ view: UIScrollView, resolver: NativeConversationScrollResolver.ResolverView) {
        self.resolver = resolver
        // 首次请求可能先于 UIKit 容器挂载；同一容器入窗后也要补发尚未执行的锚点。
        defer { if needsAnchor { requestBottomAnchor() } }
        guard scrollView !== view else { return }
        scrollView = view
        trace("scroll-attach")
        contentSizeObservation = view.observe(\.contentSize, options: [.old, .new]) { [weak self] _, change in
            guard change.oldValue != change.newValue else { return }
            Task { @MainActor [weak self] in
                self?.trace("scroll-height-change")
                self?.requestBottomAnchor()
            }
        }
    }
    func scrollToBottom() { following = true; trace("scroll-bottom-request"); requestBottomAnchor() }
    func stopFollowing() { following = false; needsAnchor = false; trace("scroll-stop") }
    func resumeFollowing() { following = true; trace("scroll-resume") }

    /// 显式回底不等待惯性或上一段动画；只冻结当前实际位置，目标仍由末尾ID定位。
    func interruptScrolling() {
        guard let scrollView else { return }
        scrollView.setContentOffset(scrollView.contentOffset, animated: false)
        if scrollView.isTracking || scrollView.isDragging {
            scrollView.panGestureRecognizer.isEnabled = false
            scrollView.panGestureRecognizer.isEnabled = true
        }
    }

    private func requestBottomAnchor() {
        guard following else { return }
        needsAnchor = true
        guard !requestQueued else { return }
        requestQueued = true
        trace("scroll-anchor-queued")
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let self else { return }
            self.requestQueued = false
            guard self.following else { return }
            self.trace("scroll-anchor-before")
            if self.resolver?.scrollToBottomAnchor() == true { self.needsAnchor = false }
            self.trace("scroll-anchor-after")
        }
    }
    private func trace(_ phase: String) {
        #if DEBUG
        NativeConversationLoadProfile.shared.scroll(phase, view: scrollView,
            data: ["following": following, "needsAnchor": needsAnchor, "queued": requestQueued])
        #endif
    }
}

struct NativeConversationScrollResolver: UIViewRepresentable {
    let access: NativeConversationScrollAccess
    let scrollToBottom: () -> Void
    func makeUIView(context: Context) -> ResolverView { ResolverView() }
    func updateUIView(_ view: ResolverView, context: Context) {
        view.access = access
        view.scrollToBottom = scrollToBottom
        view.resolve()
    }
    static func dismantleUIView(_ view: ResolverView, coordinator: ()) { view.scrollToBottom = nil }

    final class ResolverView: UIView {
        weak var access: NativeConversationScrollAccess?
        var scrollToBottom: (() -> Void)?
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            resolve()
            DispatchQueue.main.async { [weak self] in self?.resolve() }
        }
        func scrollToBottomAnchor() -> Bool {
            guard window != nil, let scrollToBottom else { return false }
            scrollToBottom()
            return true
        }
        func resolve() {
            var ancestor = superview
            while let view = ancestor {
                if let scrollView = view as? UIScrollView { access?.attach(scrollView, resolver: self); return }
                ancestor = view.superview
            }
        }
    }
}
