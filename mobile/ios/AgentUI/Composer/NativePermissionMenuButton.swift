import SwiftUI
import UIKit

/// 先构造完整的系统菜单项，标题与说明由同一次原生呈现提交。
struct NativePermissionMenuButton: UIViewRepresentable {
    let options: [PermissionMenuOption]
    let context: String?
    let mode: ApprovalMode
    let title: String
    let menuTitle: String
    let enabled: Bool
    let choose: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> PermissionMenuButton {
        let button = PermissionMenuButton(type: .system)
        button.showsMenuAsPrimaryAction = false
        button.preferredMenuElementOrder = .fixed
        button.accessibilityIdentifier = "composer.permission"
        let coordinator = context.coordinator
        button.addTarget(coordinator, action: #selector(Coordinator.presentMenu(_:)), for: .touchUpInside)
        button.onDisplay = { [weak coordinator] in coordinator?.presented = true }
        button.onEnd = { [weak coordinator, weak button] in
            guard let coordinator, let button else { return }
            coordinator.presented = false
            button.showsMenuAsPrimaryAction = false
            coordinator.update(button)
        }
        return button
    }
    func updateUIView(_ button: PermissionMenuButton, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update(button)
    }
    static func dismantleUIView(_ button: PermissionMenuButton, coordinator: Coordinator) {
        coordinator.valid = false
        button.onDisplay = nil; button.onEnd = nil
        button.contextMenuInteraction?.dismissMenu()
        button.menu = nil
    }
    @MainActor final class Coordinator: NSObject {
        var parent: NativePermissionMenuButton
        var presented = false
        var valid = true
        private var preparedOptions: [PermissionMenuOption]?
        private var preparedContext: String?
        init(parent: NativePermissionMenuButton) { self.parent = parent }

        @objc func presentMenu(_ button: PermissionMenuButton) {
            guard valid, button.isEnabled, !presented else { return }
            button.showsMenuAsPrimaryAction = true
            // 仅本次菜单打开取消分阶段文字动画，让标题和说明同帧呈现。
            UIView.performWithoutAnimation { button.performPrimaryAction() }
        }
        func update(_ button: PermissionMenuButton) {
            button.isEnabled = parent.enabled && !parent.options.isEmpty
            button.accessibilityLabel = parent.menuTitle
            button.accessibilityValue = parent.title
            button.tintColor = parent.mode == .fullAccess ? .systemOrange : .label
            button.setImage(UIImage(systemName: parent.mode.symbol), for: .normal)
            button.setPreferredSymbolConfiguration(UIImage.SymbolConfiguration(textStyle: .subheadline, scale: .large), forImageIn: .normal)
            if presented {
                if !button.isEnabled || preparedContext != parent.context || preparedOptions != parent.options {
                    button.contextMenuInteraction?.dismissMenu()
                }
                return
            }
            guard preparedOptions != parent.options || preparedContext != parent.context else { return }
            preparedOptions = parent.options; preparedContext = parent.context
            let capturedContext = parent.context
            button.menu = UIMenu(children: parent.options.map { option in
                UIAction(title: option.title, subtitle: option.detail, image: UIImage(systemName: option.symbol), identifier: UIAction.Identifier("permission.option." + option.value)) { [weak self] _ in
                    guard let self, self.valid, self.parent.enabled, self.parent.context == capturedContext,
                          self.parent.options.contains(where: { $0.value == option.value }) else { return }
                    self.parent.choose(option.value)
                }
            })
        }
    }
}

final class PermissionMenuButton: UIButton {
    var onDisplay: (() -> Void)?
    var onEnd: (() -> Void)?
    override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willDisplayMenuFor configuration: UIContextMenuConfiguration,
                                         animator: (any UIContextMenuInteractionAnimating)?) {
        super.contextMenuInteraction(interaction, willDisplayMenuFor: configuration, animator: animator)
        onDisplay?()
    }
    override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
                                         animator: (any UIContextMenuInteractionAnimating)?) {
        super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
        if let animator { animator.addCompletion { [weak self] in self?.onEnd?() } }
        else { onEnd?() }
    }
}
