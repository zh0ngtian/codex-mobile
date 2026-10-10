import UIKit
import WebKit

/// 内置页面的长按动作使用系统菜单；外部网页不安装此桥。
@available(iOS 16.0, *)
final class CodexMobileActionMenuBridge: NSObject, WKScriptMessageHandler, UIEditMenuInteractionDelegate {
    private weak var webView: WKWebView?
    private var requestID: String?
    private var actions: [[String: Any]] = []
    private var anchor = CGRect.zero
    private lazy var interaction = UIEditMenuInteraction(delegate: self)

    static func configure(_ webView: WKWebView) {
        let bridge = CodexMobileActionMenuBridge()
        bridge.webView = webView
        webView.addInteraction(bridge.interaction)
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
            if dismiss == requestID { requestID = nil; interaction.dismissMenu() }
            return
        }
        guard let id = body["requestId"] as? String,
              let entries = body["actions"] as? [[String: Any]], !entries.isEmpty, entries.count <= 12,
              let rect = body["anchor"] as? [String: Double],
              let x = rect["x"], let y = rect["y"], let width = rect["width"], let height = rect["height"],
              [x, y, width, height].allSatisfy({ $0.isFinite }) else { return }
        finish(actionID: nil)
        requestID = id
        actions = entries
        // 页面布局 CSS px 与未缩放 WKWebView points 一致；键盘造成的 visual viewport 位移由前端锚点处理。
        let scale = webView.scrollView.zoomScale
        anchor = CGRect(x: x * scale, y: y * scale, width: max(1, width * scale), height: max(1, height * scale))
            .intersection(webView.bounds)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        interaction.presentEditMenu(with: UIEditMenuConfiguration(identifier: id as NSString,
            sourcePoint: CGPoint(x: anchor.midX, y: anchor.midY)))
    }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration,
                             suggestedActions: [UIMenuElement]) -> UIMenu? {
        let id = requestID
        let icons = ["copy": "doc.on.doc", "rename": "pencil", "refresh": "arrow.clockwise", "archive": "archivebox", "pin": "pin"]
        let children = actions.compactMap { entry -> UIAction? in
            guard let actionID = entry["id"] as? String, let title = entry["title"] as? String else { return nil }
            var attributes: UIMenuElement.Attributes = []
            if entry["disabled"] as? Bool == true { attributes.insert(.disabled) }
            if entry["destructive"] as? Bool == true { attributes.insert(.destructive) }
            let icon = entry["icon"] as? String ?? ""
            return UIAction(title: title, image: UIImage(systemName: icons[icon] ?? icon), attributes: attributes) { [weak self] _ in
                guard let self, self.requestID == id else { return }
                if let text = entry["copyText"] as? String { UIPasteboard.general.string = text }
                self.finish(actionID: actionID)
            }
        }
        return UIMenu(children: children)
    }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration) -> CGRect { anchor }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, willDismissMenuFor configuration: UIEditMenuConfiguration,
                             animator: any UIEditMenuInteractionAnimating) {
        let id = configuration.identifier as? String
        animator.addCompletion { [weak self] in
            guard let self, self.requestID == id else { return }
            self.finish(actionID: nil)
        }
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
