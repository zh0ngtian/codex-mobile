import SwiftUI
import UIKit

/// 只监听呈现区域外的单击，保留原按钮、滚动及长按事件。
struct OutsideTapDismiss: UIViewRepresentable {
    let action: () -> Void
    func makeUIView(context: Context) -> BoundaryView { BoundaryView() }
    func updateUIView(_ view: BoundaryView, context: Context) { view.action = action }
    static func dismantleUIView(_ view: BoundaryView, coordinator: ()) { view.detach() }

    final class BoundaryView: UIView, UIGestureRecognizerDelegate {
        var action: () -> Void = {}
        private weak var observedWindow: UIWindow?
        private var tap: UITapGestureRecognizer?
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            detach()
            guard let window else { return }
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(outsideTap))
            recognizer.cancelsTouchesInView = false
            recognizer.delegate = self
            window.addGestureRecognizer(recognizer)
            observedWindow = window; tap = recognizer
        }
        func detach() {
            if let tap { observedWindow?.removeGestureRecognizer(tap) }
            tap = nil; observedWindow = nil
        }
        @objc private func outsideTap() { action() }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            !bounds.contains(touch.location(in: self))
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    }
}
