import Foundation
import WebKit
import UIKit

@MainActor
final class NativeUIBridge: NSObject, WKScriptMessageHandler {
    let store = NativeUIStore()
    // 业务 WebView 由既有 WebView representable 创建并拥有；桥仅保留弱引用，绝不创建第二个实例。
    private weak var webView: WKWebView?
    private let trustedURL = Bundle.main.bundleURL.appendingPathComponent("index.html").standardizedFileURL
    private var active = true
    private var needsLifecycleSync = true
    override init() {
        super.init()
        store.copyText = { [weak store] text in
            UIPasteboard.general.string = text
            UIAccessibility.post(notification: .announcement, argument: store?.label("已复制", "Copied"))
        }
    }
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
              let object = message.body as? [String: Any] else { return }
        if object["type"] as? String == "ready" { applyLifecycle(); return }
        guard object["type"] as? String == "snapshot", let snapshot = object["snapshot"] else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            store.receive(try JSONDecoder().decode(NativeSnapshot.self, from: data))
            if needsLifecycleSync { applyLifecycle() }
        } catch { store.snapshot.error = "原生界面数据无法读取：\(error.localizedDescription)" }
    }
    func setActive(_ active: Bool) {
        self.active = active
        needsLifecycleSync = true
        applyLifecycle()
    }
    private func applyLifecycle() {
        guard let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.lifecycle(active: active, trustedURL: trustedURL) else { return }
        needsLifecycleSync = false
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if error != nil { self?.needsLifecycleSync = true }
        }
    }
    private func dispatch(_ command: NativeCommand) {
        guard let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.dispatch(command, trustedURL: trustedURL) else {
            store.commandError = store.label("连接尚未就绪，请稍后重试", "The connection is not ready. Please retry.")
            return
        }
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error { self?.store.snapshot.error = error.localizedDescription }
        }
    }
}
