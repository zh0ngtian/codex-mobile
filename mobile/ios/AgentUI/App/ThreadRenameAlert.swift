import SwiftUI
import UIKit

/// 系统重命名弹窗；候选名称、加载状态和保存条件由同一个控制器管理。
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

    @MainActor final class Controller: UIViewController, UITextFieldDelegate {
        private var target: UUID?
        private var discovery: Task<Void, Never>?
        private var request: Task<Void, Never>?
        private weak var alert: UIAlertController?
        private weak var button: UIButton?
        private weak var saveAction: UIAlertAction?
        private var configuration: ThreadRenameAlert?

        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
        }

        func update(_ configuration: ThreadRenameAlert) {
            guard target != configuration.targetID else { return }
            stop()
            self.configuration = configuration
            target = configuration.targetID
            guard let id = target else { return }
            discovery = Task { [weak self] in
                for _ in 0..<60 {
                    guard let self, !Task.isCancelled, self.target == id else { return }
                    if let presenter = self.presenter(), self.view.window != nil, presenter.presentedViewController == nil {
                        self.present(configuration, id: id, from: presenter)
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

        private func present(_ configuration: ThreadRenameAlert, id: UUID, from presenter: UIViewController) {
            let alert = UIAlertController(title: configuration.title, message: nil, preferredStyle: .alert)
            alert.view.tintColor = .label
            self.alert = alert
            alert.addTextField { [weak self] field in
                field.placeholder = configuration.fieldLabel
                field.accessibilityLabel = configuration.fieldLabel
                field.text = configuration.initialName
                field.addAction(UIAction { [weak self] _ in self?.updateSave() }, for: .editingChanged)
            }
            // 用系统弹窗的第二行承载独立按钮，位置固定在名称输入框下方。
            alert.addTextField { [weak self] row in
                row.delegate = self
                row.isAccessibilityElement = false
                let button = UIButton(type: .system)
                var style = UIButton.Configuration.plain()
                style.title = configuration.summaryLabel
                style.baseForegroundColor = .label
                style.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
                style.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                    var result = attributes
                    result.font = UIFont.preferredFont(forTextStyle: .body)
                    return result
                }
                button.configuration = style
                button.accessibilityIdentifier = "rename.model-summary"
                button.addAction(UIAction { [weak self] _ in self?.run(id) }, for: .touchUpInside)
                button.translatesAutoresizingMaskIntoConstraints = false
                row.addSubview(button)
                NSLayoutConstraint.activate([
                    button.leadingAnchor.constraint(equalTo: row.leadingAnchor),
                    button.trailingAnchor.constraint(equalTo: row.trailingAnchor),
                    button.topAnchor.constraint(equalTo: row.topAnchor),
                    button.bottomAnchor.constraint(equalTo: row.bottomAnchor),
                ])
                row.accessibilityElements = [button]
                self?.button = button
            }
            alert.addAction(UIAlertAction(title: configuration.cancelLabel, style: .cancel) { _ in configuration.cancel() })
            let save = UIAlertAction(title: configuration.saveLabel, style: .default) { [weak alert] _ in
                guard let name = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return }
                configuration.save(id, name)
            }
            save.isEnabled = false; alert.addAction(save); saveAction = save
            presenter.present(alert, animated: true)
        }

        func textFieldShouldBeginEditing(_ textField: UITextField) -> Bool { false }

        private func updateSave() {
            let text = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            saveAction?.isEnabled = request == nil && !text.isEmpty && text != configuration?.initialName
        }

        private func run(_ id: UUID) {
            guard request == nil, target == id, let configuration else { return }
            button?.isEnabled = false; button?.configuration?.showsActivityIndicator = true
            alert?.textFields?.first?.isEnabled = false; saveAction?.isEnabled = false; alert?.message = nil
            request = Task { [weak self] in
                let result = await configuration.summarize(id)
                guard let self, !Task.isCancelled, self.target == id,
                      let alert = self.alert, alert.presentingViewController != nil else { return }
                self.button?.configuration?.showsActivityIndicator = false; self.button?.isEnabled = true
                alert.textFields?.first?.isEnabled = true
                alert.textFields?.first?.becomeFirstResponder()
                self.request = nil
                if let title = result.title { alert.textFields?.first?.text = title }
                else { alert.message = result.error }
                self.updateSave()
            }
        }

        func stop() {
            discovery?.cancel(); discovery = nil; request?.cancel(); request = nil
            alert?.dismiss(animated: true)
            target = nil; alert = nil; button = nil; saveAction = nil; configuration = nil
        }
    }
}
