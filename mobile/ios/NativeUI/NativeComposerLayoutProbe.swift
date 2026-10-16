import SwiftUI
import UIKit

/// 背景测量视图不参与点击；延后回传，避免layout期间修改SwiftUI观察状态。
struct NativeComposerLayoutProbe: UIViewRepresentable {
    let contextID: String
    let bridge: NativeUIBridge?
    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        return view
    }
    func updateUIView(_ view: Probe, context: Context) {
        view.contextID = contextID
        view.bridge = bridge
        view.schedule()
    }
    static func dismantleUIView(_ view: Probe, coordinator: ()) {
        view.bridge?.clearComposerLayout(contextID: view.contextID)
        view.bridge = nil
    }
    final class Probe: UIView {
        weak var bridge: NativeUIBridge?
        var contextID = ""
        private var scheduled = false
        override func layoutSubviews() { super.layoutSubviews(); schedule() }
        override func didMoveToWindow() { super.didMoveToWindow(); schedule() }
        func schedule() {
            guard !scheduled else { return }
            scheduled = true
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.scheduled = false
                self.bridge?.reportComposerLayout(self, contextID: self.contextID)
            }
        }
    }
}
