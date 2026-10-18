import SwiftUI
import UIKit

/// 在公开的宿主控制器视图上接入方向受控的Pan，跨越NavigationStack的UIKit容器。
struct NativeDrawerGestureSurface: UIViewRepresentable {
    let isOpen: Bool
    let enabled: Bool
    let width: CGFloat
    let changed: (CGFloat) -> Void
    let ended: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }
    func updateUIView(_ view: Probe, context: Context) {
        context.coordinator.parent = self
        context.coordinator.attach(from: view)
    }
    static func dismantleUIView(_ view: Probe, coordinator: Coordinator) { coordinator.detach() }

    final class Probe: UIView {
        weak var coordinator: Coordinator?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil { coordinator?.detach(); return }
            coordinator?.attach(from: self)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.window != nil else { return }
                self.coordinator?.attach(from: self)
            }
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: NativeDrawerGestureSurface
        private weak var host: UIView?
        private var pan: UIPanGestureRecognizer?
        private var startedOpen = false
        private weak var touchedView: UIView?
        init(_ parent: NativeDrawerGestureSurface) { self.parent = parent }
        func attach(from view: UIView) {
            guard view.window != nil else { return }
            var responder: UIResponder? = view
            while let current = responder {
                if let controller = current as? UIViewController {
                    let target = controller.view!
                    guard host !== target else { return }
                    detach()
                    let gesture = UIPanGestureRecognizer(target: self, action: #selector(handle))
                    gesture.maximumNumberOfTouches = 1
                    gesture.cancelsTouchesInView = true
                    gesture.delegate = self
                    target.addGestureRecognizer(gesture)
                    host = target; pan = gesture
                    return
                }
                responder = current.next
            }
        }
        func detach() {
            if let pan { host?.removeGestureRecognizer(pan) }
            host = nil; pan = nil
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard parent.enabled, let host, let touched = touch.view else { return false }
            touchedView = touched
            return touched.isDescendant(of: host)
        }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard parent.enabled, let pan = gestureRecognizer as? UIPanGestureRecognizer, let host else { return false }
            let velocity = pan.velocity(in: host)
            let start = pan.location(in: host).x - pan.translation(in: host).x
            var ancestor = touchedView
            while let view = ancestor, view !== host {
                if let text = view as? UITextView, text.isEditable || text.selectedRange.length > 0 { return false }
                if start > 44, let scroll = view as? UIScrollView,
                   scroll.isScrollEnabled, scroll.contentSize.width > scroll.bounds.width + 2 { return false }
                ancestor = view.superview
            }
            return SidebarPresentation.accepts(startX: start, dx: velocity.x, dy: velocity.y, isOpen: parent.isOpen)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            otherGestureRecognizer is UIPanGestureRecognizer
        }
        @objc private func handle(_ pan: UIPanGestureRecognizer) {
            guard let host else { return }
            switch pan.state {
            case .began:
                startedOpen = parent.isOpen
                parent.changed(pan.translation(in: host).x)
            case .changed:
                parent.changed(pan.translation(in: host).x)
            case .ended:
                let predicted = pan.translation(in: host).x + pan.velocity(in: host).x * 0.18
                parent.ended(SidebarPresentation.targetIsOpen(isOpen: startedOpen, predictedTranslation: predicted, containerWidth: parent.width))
            case .cancelled, .failed: parent.ended(startedOpen)
            default: break
            }
        }
    }
}
