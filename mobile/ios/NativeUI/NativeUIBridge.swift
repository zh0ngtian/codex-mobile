import Foundation
import WebKit
import UIKit

@MainActor
final class NativeUIBridge: NSObject, WKScriptMessageHandler {
    let store = NativeUIStore()
    // 业务 WebView 由既有 WebView representable 创建并拥有；桥仅保留弱引用，绝不创建第二个实例。
    private weak var webView: WKWebView?
    private let trustedURL = Bundle.main.bundleURL.appendingPathComponent("index.html").standardizedFileURL
    private let qrPresenter = NativeQRPresenter()
    private var recoveryRequested = false
    private var legacyVisible = true
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
        webView.accessibilityElementsHidden = !legacyVisible
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
        if object["type"] as? String == "ready" { applyLifecycle(); if recoveryRequested { recoverLegacy() }; return }
        if object["type"] as? String == "nativePreference", let id = object["id"] as? String, !id.isEmpty, id.count <= 200 {
            let preference = NativeUIPreference()
            var failure: String?
            if let raw = object["enabled"] {
                if let number = raw as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
                    do { try preference.save(number.boolValue) }
                    catch { failure = store.label("界面偏好保存失败，请重试", "Could not save the interface preference. Please retry.") }
                } else { failure = store.label("界面偏好参数无效", "Invalid interface preference") }
            }
            if object["enabled"] != nil { store.receivedNativePreference(preference.enabled, error: failure) }
            else { store.savedNativePreference = preference.enabled }
            if let webView, let script = NativeUITrust.completePreference(id: id, enabled: preference.enabled, active: store.nativeEnabled, error: failure, trustedURL: trustedURL) {
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
            return
        }
        if object["type"] as? String == "scanQR", let id = object["id"] as? String, id.count <= 200, let webView {
            qrPresenter.scan(id: id, webView: webView, chinese: store.snapshot.locale.hasPrefix("zh")) { [weak self] value, error in
                guard let self, NativeUITrust.accepts(webView.url, trustedURL: self.trustedURL),
                      let script = NativeUITrust.completeQR(id: id, value: value, error: error, trustedURL: self.trustedURL) else { return }
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
            return
        }
        guard object["type"] as? String == "snapshot", let snapshot = object["snapshot"] else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            let value = try JSONDecoder().decode(NativeSnapshot.self, from: data)
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--native-ui-trace") { print("Native snapshot panel=\(value.panel?.id ?? "none")") }
            #endif
            store.receive(value)
            if needsLifecycleSync { applyLifecycle() }
        } catch {
            #if DEBUG
            if case DecodingError.keyNotFound(let key, let context) = error {
                print("Native UI missing key: \((context.codingPath.map(\.stringValue) + [key.stringValue]).joined(separator: "."))")
            }
            #endif
            store.snapshot.error = "原生界面数据无法读取：\(error.localizedDescription)"
        }
    }
    func recoverLegacy() {
        recoveryRequested = true
        guard let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.recoverLegacy(trustedURL: trustedURL) else { return }
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
    func setLegacyVisible(_ visible: Bool) {
        legacyVisible = visible
        webView?.accessibilityElementsHidden = !visible
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
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--native-ui-trace") { print("Native command \(command.name)") }
        #endif
        guard let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.dispatch(command, trustedURL: trustedURL) else {
            let message = store.label("连接尚未就绪，请稍后重试", "The connection is not ready. Please retry.")
            store.commandError = message
            if command.name == "settings.native-ui" { store.receivedNativePreference(store.savedNativePreference, error: message) }
            return
        }
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error {
                self?.store.snapshot.error = error.localizedDescription
                if command.name == "settings.native-ui", let store = self?.store { store.receivedNativePreference(store.savedNativePreference, error: error.localizedDescription) }
            }
        }
    }
}
