import Foundation
import WebKit
import UIKit

@MainActor
final class NativeUIBridge: NSObject, WKScriptMessageHandler {
    let store = NativeUIStore()
    // 业务 WebView 由既有 WebView representable 创建并拥有；桥仅保留弱引用，绝不创建第二个实例。
    private weak var webView: WKWebView?
    // 与业务 WebView.loadFileURL 使用同一资源 URL，保留 WebKit 实际加载的 /private 路径。
    private let trustedURL = Bundle.main.url(forResource: "index", withExtension: "html")
    private let qrPresenter = NativeQRPresenter()
    private var recoveryRequested = false
    private var legacyVisible = true
    private var active = true
    private var needsLifecycleSync = true
    private var composerLayout: (contextID: String, top: CGFloat, height: CGFloat)?
    override init() {
        super.init()
        store.copyText = { [weak store] text in
            UIPasteboard.general.string = text
            UIAccessibility.post(notification: .announcement, argument: store?.label("已复制", "Copied"))
        }
    }
    func attach(_ webView: WKWebView) {
        guard self.webView !== webView else { return }
        guard let trustedURL else {
            store.snapshot.error = store.label("内置首页资源不可用", "The bundled home page is unavailable")
            return
        }
        self.webView = webView
        webView.accessibilityElementsHidden = !legacyVisible
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "nativeUI")
        controller.add(self, name: "nativeUI")
        if let script = NativeUITrust.bootstrap(trustedURL: trustedURL, enabled: store.nativeEnabled, composerEnabled: store.composerEnabled) {
            controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        store.sendCommand = { [weak self] command in self?.dispatch(command) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let trustedURL, message.name == "nativeUI", message.webView === webView,
              message.frameInfo.isMainFrame,
              NativeUITrust.accepts(message.frameInfo.request.url, trustedURL: trustedURL),
              let object = message.body as? [String: Any] else { return }
        if object["type"] as? String == "ready" { applyLifecycle(); if recoveryRequested { recoverLegacy() }; return }
        if object["type"] as? String == "nativePreference", let id = object["id"] as? String, !id.isEmpty, id.count <= 200 {
            let kind = object["kind"] as? String ?? "interface"
            let validKind = object["kind"] == nil || object["kind"] as? String == "interface" || object["kind"] as? String == "composer"
            let composer = kind == "composer"
            let preference = NativeUIPreference(storageKey: composer ? NativeUIPreference.composerKey : NativeUIPreference.key, defaultEnabled: composer)
            var failure: String?
            if !validKind { failure = store.label("界面偏好参数无效", "Invalid interface preference") }
            else if let raw = object["enabled"] {
                if let number = raw as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
                    do { try preference.save(number.boolValue) }
                    catch { failure = store.label("界面偏好保存失败，请重试", "Could not save the interface preference. Please retry.") }
                } else { failure = store.label("界面偏好参数无效", "Invalid interface preference") }
            }
            if validKind {
                if object["enabled"] != nil { store.receivedNativePreference(preference.enabled, kind: kind, error: failure) }
                else if composer { store.savedComposerPreference = preference.enabled }
                else { store.savedNativePreference = preference.enabled }
            }
            if let webView, let script = NativeUITrust.completePreference(id: id, enabled: preference.enabled, active: composer ? store.composerEnabled : store.nativeEnabled, error: failure, trustedURL: trustedURL) {
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
            return
        }
        if object["type"] as? String == "scanQR", let id = object["id"] as? String, id.count <= 200, let webView {
            qrPresenter.scan(id: id, webView: webView, chinese: store.snapshot.locale.hasPrefix("zh")) { [weak self] value, error in
                guard let self, let trustedURL = self.trustedURL,
                      NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
                      let script = NativeUITrust.completeQR(id: id, value: value, error: error, trustedURL: trustedURL) else { return }
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
    func reportComposerLayout(_ probe: UIView, contextID: String) {
        guard store.webComposerVisible, contextID == store.snapshot.contextId,
              let webView, let window = probe.window, window === webView.window,
              let trustedURL, NativeUITrust.accepts(webView.url, trustedURL: trustedURL) else { return }
        let top = max(0, probe.convert(probe.bounds, to: webView).minY)
        let height = webView.bounds.height
        guard height > 0 else { return }
        if let previous = composerLayout, previous.contextID == contextID, abs(previous.top - top) < 0.5, abs(previous.height - height) < 0.5 { return }
        composerLayout = (contextID, top, height)
        publishComposerLayout(contextID: contextID, top: top, height: height)
    }
    func clearComposerLayout(contextID: String) {
        guard let previous = composerLayout, previous.contextID == contextID else { return }
        composerLayout = nil
        publishComposerLayout(contextID: contextID, top: previous.height, height: previous.height)
    }
    private func publishComposerLayout(contextID: String, top: CGFloat, height: CGFloat) {
        guard let trustedURL, let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.composerLayout(contextId: contextID, top: Double(top), webViewHeight: Double(height), trustedURL: trustedURL) else { return }
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
    func recoverLegacy() {
        recoveryRequested = true
        guard let trustedURL, let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
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
        guard let trustedURL, let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
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
        guard let trustedURL, let webView, NativeUITrust.accepts(webView.url, trustedURL: trustedURL),
              let script = NativeUITrust.dispatch(command, trustedURL: trustedURL) else {
            let message = store.label("连接尚未就绪，请稍后重试", "The connection is not ready. Please retry.")
            store.commandError = message
            store.failNativePreference(command, error: message)
            return
        }
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error {
                self?.store.snapshot.error = error.localizedDescription
                self?.store.failNativePreference(command, error: error.localizedDescription)
            }
        }
    }
}
