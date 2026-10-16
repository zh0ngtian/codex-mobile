import SwiftUI
import UIKit

/// 同一个可交互系统菜单同时接收工具栏点击与侧栏新建附件的程序打开请求。
struct NativeComposerAttachmentMenu: UIViewRepresentable {
    let store: NativeUIStore
    let contextID: String?
    let isEnabled: Bool
    @Binding var isOpen: Bool
    let fontSize: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> NativeComposerAttachmentMenuButton {
        let button = NativeComposerAttachmentMenuButton(type: .system)
        button.showsMenuAsPrimaryAction = true
        button.preferredMenuElementOrder = .fixed
        button.tintColor = .label
        button.accessibilityIdentifier = "native-attachment-menu"
        let coordinator = context.coordinator
        button.onDisplay = { [weak coordinator, weak button] in
            guard let button else { return }
            coordinator?.willDisplay(button)
        }
        button.onEnd = { [weak coordinator] in coordinator?.didEnd() }
        button.onWindow = { [weak coordinator, weak button] in
            guard let button else { return }
            coordinator?.presentIfRequested(button)
        }
        return button
    }

    func updateUIView(_ button: NativeComposerAttachmentMenuButton, context: Context) {
        context.coordinator.parent = self
        button.isEnabled = isEnabled
        button.accessibilityLabel = store.label("添加附件", "Add Attachment")
        button.setImage(UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: fontSize, weight: .semibold)), for: .normal)
        context.coordinator.update(button)
    }

    static func dismantleUIView(_ button: NativeComposerAttachmentMenuButton, coordinator: Coordinator) {
        coordinator.invalidate()
        button.onDisplay = nil; button.onEnd = nil; button.onWindow = nil
        button.contextMenuInteraction?.dismissMenu()
    }

    @MainActor final class Coordinator {
        var parent: NativeComposerAttachmentMenu
        private var menuContext: NativeComposerMenuContext?
        private var selected: NativeComposerAttachmentAction?
        private var presented = false
        private var opening = false
        private var presentationScheduled = false

        init(parent: NativeComposerAttachmentMenu) { self.parent = parent }

        func update(_ button: NativeComposerAttachmentMenuButton) {
            if presented || opening {
                if !allowsCurrentContext || !parent.isOpen {
                    selected = nil
                    button.contextMenuInteraction?.dismissMenu()
                    if !presented { opening = false }
                }
                return
            }
            let session = NativeComposerMenuContext(contextID: parent.contextID)
            menuContext = session
            let chinese = parent.store.snapshot.locale.lowercased().hasPrefix("zh")
            button.menu = UIMenu(children: NativeComposerAttachmentAction.allCases.map { action in
                UIAction(title: action.title(chinese: chinese), image: UIImage(systemName: action.symbol)) { [weak self] _ in
                    guard let self,
                          session.allowsExecution(contextID: self.parent.store.snapshot.contextId,
                              editable: self.parent.store.composerCanEdit, sidebarOpen: self.parent.store.sidebarOpen) else { return }
                    self.selected = action
                }
            })
            if parent.isOpen {
                opening = true
                presentIfRequested(button)
            }
        }

        func presentIfRequested(_ button: NativeComposerAttachmentMenuButton) {
            guard opening, !presented, !presentationScheduled, button.window != nil else { return }
            presentationScheduled = true
            // SwiftUI 更新或挂载期间不直接呈现；侧栏意图会在同一按钮入 window 后消费。
            DispatchQueue.main.async { [weak self, weak button] in
                guard let self else { return }
                self.presentationScheduled = false
                guard let button, self.opening, !self.presented else { return }
                guard self.parent.isOpen, self.allowsCurrentContext, button.window != nil else {
                    self.opening = false
                    self.parent.isOpen = false
                    return
                }
                button.performPrimaryAction()
            }
        }

        func willDisplay(_ button: NativeComposerAttachmentMenuButton) {
            guard allowsCurrentContext else {
                selected = nil
                opening = false
                parent.isOpen = false
                DispatchQueue.main.async { [weak button] in button?.contextMenuInteraction?.dismissMenu() }
                return
            }
            opening = false
            presented = true
            parent.isOpen = true
        }

        func didEnd() {
            let action = selected
            let context = menuContext
            selected = nil
            opening = false
            presented = false
            parent.isOpen = false
            // 系统菜单完全关闭再打开照片、文件或 Skill 面板，取消后仍可重新打开。
            if let action, let context {
                parent.store.chooseComposerAttachment(action, contextID: context.contextID)
            }
        }

        func invalidate() {
            selected = nil
            opening = false
            presented = false
            presentationScheduled = false
        }

        private var allowsCurrentContext: Bool {
            parent.isEnabled && menuContext?.allowsExecution(contextID: parent.store.snapshot.contextId,
                editable: parent.store.composerCanEdit, sidebarOpen: parent.store.sidebarOpen) == true
        }
    }
}

/// 保留 UIButton 的正常命中测试，与仅用于网页定位的透明按钮职责不同。
final class NativeComposerAttachmentMenuButton: UIButton {
    var onDisplay: (() -> Void)?
    var onEnd: (() -> Void)?
    var onWindow: (() -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { onWindow?() }
    }

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
