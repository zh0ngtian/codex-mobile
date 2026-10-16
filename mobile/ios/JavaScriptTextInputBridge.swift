import UIKit
import WebKit

/// 为可信内置首页的 window.prompt 提供系统文本输入，不复制会话重命名业务。
@MainActor
final class CodexMobileJavaScriptTextInputBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private weak var alert: UIAlertController?
    private var loadingObservation: NSKeyValueObservation?
    private var completion: ((String?) -> Void)?
    private var requestID: UUID?
    private let trustedURL = Bundle.main.url(forResource: "index", withExtension: "html")
    private var locale = "zh-CN"

    func configure(_ webView: WKWebView) {
        self.webView = webView
        guard let trustedURL,
              let data = try? JSONEncoder().encode(trustedURL.absoluteString),
              let encodedURL = String(data: data, encoding: .utf8) else { return }
        let controller = webView.configuration.userContentController
        controller.add(self, name: "javaScriptTextInputLanguage")
        controller.addUserScript(WKUserScript(
            source: Self.languageScript.replacingOccurrences(of: "__CODEX_TRUSTED_URL__", with: encodedURL),
            injectionTime: .atDocumentEnd, forMainFrameOnly: true
        ))
        loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
            // WKWebView 的加载状态在主线程更新，KVO 的闭包签名未保留 actor 信息。
            MainActor.assumeIsolated {
                if view.isLoading { self?.cancel() }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let trustedURL, message.webView === webView, message.frameInfo.isMainFrame,
              NativeUITrust.accepts(message.frameInfo.request.url, trustedURL: trustedURL),
              NativeUITrust.accepts(webView?.url, trustedURL: trustedURL),
              let body = message.body as? [String: Any], let value = body["locale"] as? String,
              ["zh-CN", "en"].contains(value) else { return }
        locale = value
    }

    func present(_ webView: WKWebView, prompt: String, defaultText: String?, frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard completion == nil, self.webView === webView, let trustedURL, frame.isMainFrame,
              NativeUITrust.accepts(frame.request.url, trustedURL: trustedURL),
              NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let presenter = webView.window?.rootViewController,
              presenter.presentedViewController == nil, !presenter.isBeingDismissed else {
            completionHandler(nil)
            return
        }
        completion = completionHandler
        let id = UUID()
        requestID = id
        let dialog = UIAlertController(title: prompt, message: nil, preferredStyle: .alert)
        dialog.view.accessibilityIdentifier = "codex.javascript.text-input"
        dialog.addTextField { input in
            input.text = defaultText
            input.accessibilityIdentifier = "codex.javascript.text-input.value"
        }
        let chinese = locale.hasPrefix("zh")
        dialog.addAction(UIAlertAction(title: chinese ? "取消" : "Cancel", style: .cancel) { [weak self] _ in
            self?.finish(nil, id: id)
        })
        dialog.addAction(UIAlertAction(title: chinese ? "保存" : "Save", style: .default) { [weak self, weak dialog] _ in
            self?.finish(dialog?.textFields?.first?.text, id: id)
        })
        alert = dialog
        presenter.present(dialog, animated: true)
    }

    private func finish(_ value: String?, id: UUID) {
        guard requestID == id, let reply = completion else { return }
        requestID = nil
        completion = nil
        alert = nil
        // 回调触发前解除占用；旧 action 或导航回调不能再次完成请求。
        reply(value)
    }

    private func cancel() {
        guard let id = requestID else { return }
        let presented = alert
        finish(nil, id: id)
        presented?.dismiss(animated: false)
    }

    // prompt 暂停网页 JS 时不能再异步读取语言，提前同步 App 已有的 lang 单一状态。
    static let languageScript = """
    (() => {
      const trustedURL = __CODEX_TRUSTED_URL__;
      const sync = () => {
        if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(trustedURL).href) return;
        window.webkit?.messageHandlers?.javaScriptTextInputLanguage?.postMessage({ locale: document.documentElement.lang });
      };
      sync();
      new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    })();
    """
}
