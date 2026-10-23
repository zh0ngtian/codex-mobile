import SwiftUI
import UIKit

/// 原生重命名弹窗的呈现桥；表单与异步候选均由独立弹窗持有。
struct ThreadRenameAlert: UIViewControllerRepresentable {
    let targetID: UUID?
    let initialName: String
    let title: String
    let fieldLabel: String
    let summaryLabel: String
    let cancelLabel: String
    let saveLabel: String
    let summarize: @MainActor (UUID) async -> (title: String?, error: String?)
    let save: @MainActor (UUID, String) -> Void
    let cancel: @MainActor () -> Void

    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) { controller.update(self) }
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) { controller.stop() }

    @MainActor final class Controller: UIViewController {
        private var target: UUID?
        private var discovery: Task<Void, Never>?
        private weak var dialog: ThreadRenameDialogController?

        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
        }

        func update(_ configuration: ThreadRenameAlert) {
            guard target != configuration.targetID else { return }
            stop()
            target = configuration.targetID
            guard let id = target else { return }
            discovery = Task { [weak self] in
                for _ in 0..<60 {
                    guard let self, !Task.isCancelled, self.target == id else { return }
                    if let presenter = self.presenter(), self.view.window != nil, presenter.presentedViewController == nil {
                        let dialog = ThreadRenameDialogController(configuration: configuration, id: id)
                        self.dialog = dialog
                        presenter.present(dialog, animated: true)
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(50))
                }
            }
        }

        private func presenter() -> UIViewController? {
            guard var controller = parent else { return nil }
            while let parent = controller.parent { controller = parent }
            return controller
        }

        func stop() {
            discovery?.cancel(); discovery = nil
            dialog?.dismiss(animated: true)
            target = nil; dialog = nil
        }
    }
}
