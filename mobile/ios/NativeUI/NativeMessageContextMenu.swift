import SwiftUI
import UIKit

/// 在消息菜单的系统关闭动画完成后交接操作，避免 UIKit 清理旧选区时撤销新选区。
struct NativeMessageContextMenu<Content: View>: UIViewControllerRepresentable {
    let copyTitle: String
    let editTitle: String
    let selectTitle: String
    let canEdit: Bool
    let canSelect: Bool
    let menuEnabled: Bool
    let copy: () -> Void
    let edit: () -> Void
    let select: () -> Void
    @ViewBuilder let content: () -> Content

    struct HostedContent: View {
        let content: Content
        let values: EnvironmentValues
        var body: some View {
            // 只传显示环境；外层 representable 的辅助功能包装不能覆盖内部正文节点。
            content.environment(\.colorScheme, values.colorScheme)
                .environment(\.dynamicTypeSize, values.dynamicTypeSize)
                .environment(\.legibilityWeight, values.legibilityWeight)
                .environment(\.locale, values.locale)
                .environment(\.layoutDirection, values.layoutDirection)
                .environment(\.openURL, values.openURL)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> UIHostingController<HostedContent> {
        let controller = UIHostingController(rootView: HostedContent(content: content(), values: context.environment))
        controller.view.backgroundColor = .clear
        controller.view.addInteraction(UIContextMenuInteraction(delegate: context.coordinator))
        return controller
    }

    func updateUIViewController(_ controller: UIHostingController<HostedContent>, context: Context) {
        context.coordinator.message = self
        controller.rootView = HostedContent(content: content(), values: context.environment)
        controller.view.invalidateIntrinsicContentSize()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiViewController: UIHostingController<HostedContent>, context: Context) -> CGSize? {
        uiViewController.sizeThatFits(in: CGSize(width: proposal.width ?? UIView.layoutFittingExpandedSize.width,
                                               height: .greatestFiniteMagnitude))
    }

    @MainActor final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        var message: NativeMessageContextMenu?
        private var pendingAction: (() -> Void)?

        func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
            guard let message, message.menuEnabled else { return nil }
            pendingAction = nil
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                func action(_ title: String, _ symbol: String, enabled: Bool = true, perform: @escaping () -> Void) -> UIAction {
                    UIAction(title: title, image: UIImage(systemName: symbol), attributes: enabled ? [] : .disabled) { [weak self] _ in
                        self?.pendingAction = perform
                    }
                }
                return UIMenu(children: [
                    action(message.copyTitle, "doc.on.doc", perform: message.copy),
                    action(message.editTitle, "pencil", enabled: message.canEdit, perform: message.edit),
                    action(message.selectTitle, "text.cursor", enabled: message.canSelect, perform: message.select),
                ])
            }
        }

        func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration, animator: (any UIContextMenuInteractionAnimating)?) {
            let action = pendingAction
            pendingAction = nil
            if let animator { animator.addCompletion { action?() } }
            else { action?() }
        }

        func contextMenuInteraction(_ interaction: UIContextMenuInteraction, previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration) -> UITargetedPreview? {
            guard let view = interaction.view else { return nil }
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(roundedRect: view.bounds, cornerRadius: 23)
            return UITargetedPreview(view: view, parameters: parameters)
        }
    }
}
