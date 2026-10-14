import Foundation
import WebKit

@MainActor
final class NativeUIBridge: NSObject, WKScriptMessageHandler {
    static let shared = NativeUIBridge()
    let store = NativeUIStore()
    // 业务 WebView 由既有 WebView representable 创建并拥有；桥仅保留弱引用，绝不创建第二个实例。
    private weak var webView: WKWebView?
    static let script = """
    if (location.protocol === "file:" && window === window.top) {
    window.codexMobileNativeCommand = function(command) {
      window.dispatchEvent(new CustomEvent("codex-mobile-native-command", {detail: command}));
    };
    window.codexMobilePublishNativeSnapshot = function(snapshot) {
      window.webkit.messageHandlers.nativeUI.postMessage({type: "snapshot", snapshot: snapshot});
    };
    }
    """
    func attach(_ webView: WKWebView) {
        guard self.webView !== webView else { return }
        self.webView = webView
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "nativeUI")
        controller.add(self, name: "nativeUI")
        let enabled = store.nativeEnabled ? "true" : "false"
        controller.addUserScript(WKUserScript(source: "if (location.protocol === 'file:' && window === window.top) window.__CODEX_NATIVE_UI__ = \(enabled);\n" + Self.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        store.sendCommand = { [weak self] command in self?.dispatch(command) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeUI", message.webView === webView,
              message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, frameURL.isFileURL,
              frameURL.standardizedFileURL == Bundle.main.bundleURL.appendingPathComponent("index.html").standardizedFileURL,
              let object = message.body as? [String: Any], object["type"] as? String == "snapshot", let snapshot = object["snapshot"] else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            store.receive(try JSONDecoder().decode(NativeSnapshot.self, from: data))
        } catch { store.snapshot.error = "原生界面数据无法读取：\(error.localizedDescription)" }
    }
    private func dispatch(_ command: NativeCommand) {
        guard let webView, webView.url?.isFileURL == true, let data = try? JSONEncoder().encode(command), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.codexMobileNativeCommand(\(json))") { [weak self] _, error in
            if let error { self?.store.snapshot.error = error.localizedDescription }
        }
    }
}
