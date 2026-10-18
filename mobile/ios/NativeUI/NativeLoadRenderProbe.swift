#if DEBUG
import SwiftUI
import UIKit

/// 首次显示机会与布局稳定探针；仅测量会话内容，不把XCTest等待计入耗时。
struct NativeLoadRenderProbe: UIViewRepresentable {
    let threadID: String?
    let ready: Bool
    func makeUIView(context: Context) -> ProbeView { ProbeView() }
    func updateUIView(_ view: ProbeView, context: Context) { view.configure(thread: threadID, ready: ready) }
    static func dismantleUIView(_ view: ProbeView, coordinator: ()) { view.stop() }
    final class ProbeView: UIView {
        private var link: CADisplayLink?
        private var traceID: String?
        private var thread: String?
        private var isReady = false
        private var started = 0.0
        private var lastVisualChange = 0.0
        private var signature = ""
        private var firstFrame = false
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        func configure(thread: String?, ready: Bool) {
            self.thread = thread; isReady = ready
            guard NativeConversationLoadProfile.enabled else { return }
            if !ready { stop(); traceID = nil; return }
            setNeedsLayout()
        }
        override func layoutSubviews() {
            super.layoutSubviews()
            let profile = NativeConversationLoadProfile.shared
            guard isReady, window != nil, profile.ready, profile.activeThread == thread,
                  let id = profile.activeID, traceID != id else { return }
            stop(); traceID = id; started = NativeConversationLoadProfile.now
            lastVisualChange = started; signature = ""; firstFrame = false
            profile.mark("native-layout")
            let link = CADisplayLink(target: self, selector: #selector(tick))
            self.link = link; link.add(to: .main, forMode: .common)
        }
        override func didMoveToWindow() { super.didMoveToWindow(); if window == nil { stop() } }
        func stop() { link?.invalidate(); link = nil }
        @objc private func tick() {
            let profile = NativeConversationLoadProfile.shared
            guard profile.activeID == traceID, window != nil else { stop(); return }
            let now = NativeConversationLoadProfile.now
            if !firstFrame { profile.mark("native-first-frame"); firstFrame = true }
            var ancestor = superview
            while let view = ancestor, !(view is UIScrollView) { ancestor = view.superview }
            if let scroll = ancestor as? UIScrollView {
                let shown = layer.presentation()?.convert(bounds, to: window?.layer.presentation()) ?? convert(bounds, to: window)
                let x = (shown.minX * 3).rounded() / 3
                let next = "\(scroll.contentSize.height):\(scroll.contentOffset.y):\(scroll.bounds.width):\(x)"
                if next != signature { signature = next; lastVisualChange = now }
            }
            let lastChange = max(lastVisualChange, profile.lastUpdate)
            if !profile.waitingForRPC && now - lastChange > 300 {
                profile.finish(at: lastChange); stop()
            } else if now - started > 15_000 { profile.finish(at: now, timedOut: true); stop() }
        }
    }
}
#endif
