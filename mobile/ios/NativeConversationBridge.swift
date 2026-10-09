import UIKit
import WebKit

/// UIViewRepresentable 返回此容器，SwiftUI 只管理容器边界；WK 与原生 UI 为 UIKit sibling。
final class CodexMobileConversationHostView: UIView {
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        backgroundColor = .clear
        isAccessibilityElement = false
        accessibilityIdentifier = "codex.native.host"
        addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

/// 主 WebView 保留 JS 生命周期，原生 child 仅覆盖当前对话区域。
final class CodexMobileNativeConversationBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private var conversation: NativeConversationViewController?
    private var attachmentRetryScheduled = false

    static func configure(_ webView: WKWebView) {
        let bridge = CodexMobileNativeConversationBridge()
        bridge.webView = webView
        let controller = webView.configuration.userContentController
        controller.add(bridge, name: "nativeConversation")
        controller.addUserScript(WKUserScript(source: """
        if (location.protocol === 'file:') {
          window.__codexNativeConversationReady = true;
          window.dispatchEvent(new CustomEvent('codex-mobile-native-conversation-ready'));
        }
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard Thread.isMainThread, message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.isFileURL == true, webView?.url?.isFileURL == true,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "hide", let contextId = body["contextId"] as? String {
            if conversation?.hide(contextId: contextId) == true { webView?.accessibilityElementsHidden = false }
            return
        }
        guard type == "snapshot", let object = body["snapshot"] as? [String: Any], object["version"] as? Int == 1,
              let data = try? JSONSerialization.data(withJSONObject: object),
              let snapshot = try? JSONDecoder().decode(NativeConversationSnapshot.self, from: data),
              snapshot.version == 1, !snapshot.contextId.isEmpty else { return }
        let controller: NativeConversationViewController
        if let existing = conversation { controller = existing }
        else {
            controller = NativeConversationViewController()
            controller.onAction = { [weak self] action in self?.dispatch(action) }
            conversation = controller
        }
        controller.receive(snapshot)
        attachIfPossible()
        if controller.parent != nil { webView?.accessibilityElementsHidden = snapshot.visible }
    }

    private func attachIfPossible() {
        guard let webView, let controller = conversation, controller.parent == nil else { return }
        guard webView.window != nil, let parent = owner(of: webView), let host = host(of: webView) else {
            guard !attachmentRetryScheduled else { return }
            attachmentRetryScheduled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                self?.attachmentRetryScheduled = false
                self?.attachIfPossible()
            }
            return
        }
        parent.addChild(controller)
        host.addSubview(controller.view)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: host.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: host.bottomAnchor)
        ])
        controller.didMove(toParent: parent)
        webView.accessibilityElementsHidden = controller.isConversationVisible
    }

    private func host(of webView: WKWebView) -> CodexMobileConversationHostView? {
        var container = webView.superview
        while let current = container {
            if let host = current as? CodexMobileConversationHostView { return host }
            container = current.superview
        }
        return nil
    }

    private func owner(of webView: WKWebView) -> UIViewController? {
        var responder: UIResponder? = webView.next
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }

    private func dispatch(_ action: NativeConversationAction) {
        guard webView?.url?.isFileURL == true,
              let data = try? JSONEncoder().encode(action), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('codex-mobile-native-conversation-action', { detail: \(json) }));")
    }
}
