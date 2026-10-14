import Foundation
import WebKit

@MainActor
final class NativeUIBridge: NSObject, WKScriptMessageHandler {
    static let shared = NativeUIBridge()
    let store = NativeUIStore()
    // 业务 WebView 由既有 WebView representable 创建并拥有；桥仅保留弱引用，绝不创建第二个实例。
    private weak var webView: WKWebView?
    private let trustedURL = Bundle.main.bundleURL.appendingPathComponent("index.html").standardizedFileURL
    func attach(_ webView: WKWebView) {
        guard self.webView !== webView else { return }
        self.webView = webView
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "nativeUI")
        controller.add(self, name: "nativeUI")
        if let script = NativeUITrust.bootstrap(trustedURL: trustedURL, enabled: store.nativeEnabled) {
            controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        store.sendCommand = { [weak self] command in self?.dispatch(command) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeUI", message.webView === webView,
              message.frameInfo.isMainFrame,
              NativeUITrust.accepts(message.frameInfo.request.url, trustedURL: trustedURL),
              let object = message.body as? [String: Any], object["type"] as? String == "snapshot", let snapshot = object["snapshot"] else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            store.receive(try JSONDecoder().decode(NativeSnapshot.self, from: data))
        } catch { store.snapshot.error = "原生界面数据无法读取：\(error.localizedDescription)" }
    }
    private func dispatch(_ command: NativeCommand) {
        guard let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.dispatch(command, trustedURL: trustedURL) else { return }
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error { self?.store.snapshot.error = error.localizedDescription }
        }
    }
}
