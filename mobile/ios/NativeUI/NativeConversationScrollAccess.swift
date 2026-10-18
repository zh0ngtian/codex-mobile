import SwiftUI
import UIKit

/// 底部定位始终由ScrollViewReader的末尾ID执行；UIKit只观察高度回填，不写估算坐标。
@MainActor final class NativeConversationScrollAccess {
    private weak var scrollView: UIScrollView?
    private weak var resolver: NativeConversationScrollResolver.ResolverView?
    private var contentSizeObservation: NSKeyValueObservation?
    private var following = false
    private var requestQueued = false

    func attach(_ view: UIScrollView, resolver: NativeConversationScrollResolver.ResolverView) {
        self.resolver = resolver
        guard scrollView !== view else { return }
        scrollView = view
        contentSizeObservation = view.observe(\.contentSize, options: [.old, .new]) { [weak self] _, change in
            guard change.oldValue != change.newValue else { return }
            Task { @MainActor [weak self] in self?.requestBottomAnchor() }
        }
    }
    func scrollToBottom() { following = true; requestBottomAnchor() }
    func stopFollowing() { following = false }
    func resumeFollowing() { following = true }

    private func requestBottomAnchor() {
        guard following, !requestQueued else { return }
        requestQueued = true
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let self else { return }
            self.requestQueued = false
            guard self.following else { return }
            self.resolver?.scrollToBottomAnchor()
        }
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
        func scrollToBottomAnchor() {
            guard window != nil else { return }
            scrollToBottom?()
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
