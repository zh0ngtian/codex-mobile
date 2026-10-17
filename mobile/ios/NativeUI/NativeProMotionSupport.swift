import SwiftUI
import UIKit

/// 被动表达整个窗口的刷新率偏好，不创建常驻动画或强制绘制循环。
@available(iOS 18.0, *)
struct NativeProMotionSupport: UIViewRepresentable {
    func makeUIView(context: Context) -> RefreshView { RefreshView() }
    func updateUIView(_ view: RefreshView, context: Context) {}
    static func dismantleUIView(_ view: RefreshView, coordinator: ()) { view.stop() }

    final class RefreshView: UIView {
        private var updateLink: UIUpdateLink?
        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            NotificationCenter.default.addObserver(self, selector: #selector(active), name: UIApplication.didBecomeActiveNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(inactive), name: UIApplication.willResignActiveNotification, object: nil)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            stop()
            guard let scene = window?.windowScene else { return }
            let preferred = Float(min(120, scene.screen.maximumFramesPerSecond))
            let link = UIUpdateLink(windowScene: scene)
            // 默认被动更新；不设置 continuous updates，也不安装逐帧回调。
            link.preferredFrameRateRange = CAFrameRateRange(minimum: min(80, preferred), maximum: preferred, preferred: preferred)
            link.isEnabled = UIApplication.shared.applicationState == .active
            updateLink = link
        }
        func stop() { updateLink?.isEnabled = false; updateLink = nil }
        @objc private func active() { updateLink?.isEnabled = true }
        @objc private func inactive() { updateLink?.isEnabled = false }
    }
}
