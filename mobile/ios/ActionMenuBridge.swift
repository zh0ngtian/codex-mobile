import UIKit
import WebKit

/// 内置页面使用平级纵向系统菜单；外部网页不安装此桥。
@available(iOS 16.0, *)
final class CodexMobileActionMenuBridge: NSObject, WKScriptMessageHandler, UIAdaptivePresentationControllerDelegate {
    private weak var webView: WKWebView?
    private var requestID: String?
    private var menuButton: CodexMobileMenuButton?
    private var legacyMenu: UIAlertController?

    static func configure(_ webView: WKWebView) {
        let bridge = CodexMobileActionMenuBridge()
        bridge.webView = webView
        let controller = webView.configuration.userContentController
        controller.add(bridge, name: "actionMenu")
        controller.addUserScript(WKUserScript(source: """
        (() => {
          if (location.protocol !== 'file:' || window !== window.top) return;
          window.CodexMobileActionMenu = {
            show: request => window.webkit.messageHandlers.actionMenu.postMessage(JSON.parse(request)),
            dismiss: requestId => window.webkit.messageHandlers.actionMenu.postMessage({dismiss: requestId})
          };
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, url.isFileURL,
              url.standardizedFileURL == Bundle.main.bundleURL.appendingPathComponent("index.html").standardizedFileURL,
              let body = message.body as? [String: Any], let webView else { return }
        if let dismiss = body["dismiss"] as? String {
            if dismiss == requestID { requestID = nil; dismissPresentation() }
            return
        }
        guard let id = body["requestId"] as? String,
              let entries = body["actions"] as? [[String: Any]], !entries.isEmpty, entries.count <= 12,
              let rect = body["anchor"] as? [String: Double],
              let x = rect["x"], let y = rect["y"], let width = rect["width"], let height = rect["height"],
              [x, y, width, height].allSatisfy({ $0.isFinite }) else { return }
        finish(actionID: nil)
        dismissPresentation()
        requestID = id
        let scale = webView.scrollView.zoomScale
        let anchor = CGRect(x: x * scale, y: y * scale, width: max(1, width * scale), height: max(1, height * scale))
            .intersection(webView.bounds)
        guard !anchor.isNull, !anchor.isEmpty else { finish(actionID: nil); return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if #available(iOS 17.4, *) {
            let icons = ["copy": "doc.on.doc", "rename": "pencil", "refresh": "arrow.clockwise", "archive": "archivebox", "pin": "pin"]
            let actions = entries.compactMap { entry -> UIAction? in
                guard entry["id"] is String, let title = entry["title"] as? String else { return nil }
                var attributes: UIMenuElement.Attributes = []
                if entry["disabled"] as? Bool == true { attributes.insert(.disabled) }
                if entry["destructive"] as? Bool == true { attributes.insert(.destructive) }
                let icon = entry["icon"] as? String ?? ""
                return UIAction(title: title, image: UIImage(systemName: icons[icon] ?? icon), attributes: attributes) { [weak self] _ in
                    self?.select(entry, requestID: id)
                }
            }
            guard !actions.isEmpty else { finish(actionID: nil); return }
            let button = CodexMobileMenuButton(frame: anchor)
            button.isAccessibilityElement = false
            button.showsMenuAsPrimaryAction = true
            // 根菜单直接包含动作，不包装子菜单；UIKit 按纵向列表呈现。
            button.menu = UIMenu(children: actions)
            button.onEnd = { [weak self, weak button] in
                guard let self, let button else { return }
                button.removeFromSuperview()
                guard self.menuButton === button else { return }
                self.menuButton = nil
                if self.requestID == id { self.finish(actionID: nil) }
            }
            menuButton = button
            webView.addSubview(button)
            button.performPrimaryAction()
        } else {
            presentLegacyMenu(entries, requestID: id, anchor: anchor, webView: webView)
        }
    }

    private func presentLegacyMenu(_ entries: [[String: Any]], requestID id: String, anchor: CGRect, webView: WKWebView) {
        guard var presenter = webView.window?.rootViewController else { finish(actionID: nil); return }
        while let presented = presenter.presentedViewController { presenter = presented }
        let menu = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        for entry in entries {
            guard entry["id"] is String, let title = entry["title"] as? String else { continue }
            let action = UIAlertAction(title: title, style: entry["destructive"] as? Bool == true ? .destructive : .default) { [weak self] _ in
                self?.legacyMenu = nil
                self?.select(entry, requestID: id)
            }
            action.isEnabled = entry["disabled"] as? Bool != true
            menu.addAction(action)
        }
        menu.addAction(UIAlertAction(title: NSLocalizedString("取消", comment: "关闭操作菜单"), style: .cancel) { [weak self] _ in
            guard let self, self.requestID == id else { return }
            self.legacyMenu = nil
            self.finish(actionID: nil)
        })
        menu.popoverPresentationController?.sourceView = webView
        menu.popoverPresentationController?.sourceRect = anchor
        legacyMenu = menu
        presenter.present(menu, animated: true)
        menu.presentationController?.delegate = self
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard presentationController.presentedViewController === legacyMenu else { return }
        legacyMenu = nil
        finish(actionID: nil)
    }

    private func select(_ entry: [String: Any], requestID id: String) {
        guard requestID == id, entry["disabled"] as? Bool != true, let actionID = entry["id"] as? String else { return }
        if let text = entry["copyText"] as? String { UIPasteboard.general.string = text }
        finish(actionID: actionID)
    }

    private func dismissPresentation() {
        menuButton?.contextMenuInteraction?.dismissMenu()
        menuButton?.removeFromSuperview()
        menuButton = nil
        legacyMenu?.dismiss(animated: true)
        legacyMenu = nil
    }

    private func finish(actionID: String?) {
        guard let id = requestID else { return }
        requestID = nil
        let result: [String: Any] = ["requestId": id, "actionId": actionID ?? NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('codex-mobile-action-menu', {detail: \(json)}));", completionHandler: nil)
    }
}

@available(iOS 16.0, *)
private final class CodexMobileMenuButton: UIButton {
    var onEnd: (() -> Void)?

    override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
                                         animator: (any UIContextMenuInteractionAnimating)?) {
        super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
        if let animator { animator.addCompletion { [weak self] in self?.onEnd?() } }
        else { onEnd?() }
    }
}
