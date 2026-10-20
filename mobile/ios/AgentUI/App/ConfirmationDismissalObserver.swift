import SwiftUI
import UIKit

/// 只观察当前Root的alert退出，不持有窗口，不替SwiftUI执行dismiss。
struct ConfirmationDismissalObserver: UIViewControllerRepresentable {
    let closingID: String?
    let panelID: String?
    let completed: (String) -> Void

    func makeUIViewController(context: Context) -> ObserverController { ObserverController() }
    func updateUIViewController(_ controller: ObserverController, context: Context) {
        controller.observe(closingID: closingID, panelID: panelID, completed: completed)
    }
    static func dismantleUIViewController(_ controller: ObserverController, coordinator: ()) { controller.stop() }

    @MainActor final class ObserverController: UIViewController {
        private var closingID: String?
        private var panelID: String?
        private weak var alert: UIAlertController?
        private var task: Task<Void, Never>?
        private var completed: ((String) -> Void)?
        private var transitionID: ObjectIdentifier?
        private var observationID: UUID?

        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
        }
        func observe(closingID: String?, panelID: String?, completed: @escaping (String) -> Void) {
            self.panelID = panelID; self.completed = completed
            guard let closingID else { stop(); return }
            if self.closingID != closingID {
                stop(); self.closingID = closingID; alert = localAlert()
            }
            guard task == nil else { return }
            let observation = UUID()
            observationID = observation
            task = Task { [weak self] in
                let deadline = Date().addingTimeInterval(3)
                while !Task.isCancelled, Date() < deadline {
                    guard let self, self.closingID == closingID, self.observationID == observation else { return }
                    if self.finishIfDismissed(closingID) { return }
                    if let transition = self.alert?.transitionCoordinator {
                        let id = ObjectIdentifier(transition as AnyObject)
                        if self.transitionID != id {
                            self.transitionID = id
                            transition.animate(alongsideTransition: nil) { [weak self] _ in
                                guard let self, self.observationID == observation else { return }
                                _ = self.finishIfDismissed(closingID)
                            }
                        }
                    }
                    try? await Task.sleep(for: .milliseconds(50))
                }
                // 超时保持关闭锁；后续Root更新可再次核对，不强行呈现。
                if self?.observationID == observation { self?.task = nil; self?.observationID = nil }
            }
        }
        func stop() { task?.cancel(); task = nil; closingID = nil; alert = nil; transitionID = nil; observationID = nil }
        private func localAlert() -> UIAlertController? {
            guard var controller = parent else { return nil }
            while let parent = controller.parent { controller = parent }
            while let presented = controller.presentedViewController {
                if let alert = presented as? UIAlertController { return alert }
                controller = presented
            }
            return nil
        }
        private func finishIfDismissed(_ id: String) -> Bool {
            guard closingID == id, panelID != id, view.window != nil else { return false }
            if let alert {
                guard alert.presentingViewController == nil, !alert.isBeingDismissed, !alert.isBeingPresented else { return false }
            } else if localAlert() != nil { return false }
            let completion = completed
            stop()
            completion?(id)
            return true
        }
    }
}
