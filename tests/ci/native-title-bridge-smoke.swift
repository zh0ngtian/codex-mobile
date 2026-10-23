import AppKit
import WebKit

@main
@MainActor
final class TitleBridgeSmoke: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var received = Set<String>()
    private var failure: String?
    private var finished = false
    private let entry: String

    init(entry: String) { self.entry = entry }

    static func main() throws {
        _ = NSApplication.shared
        let html = URL(fileURLWithPath: CommandLine.arguments[1])
        let smoke = TitleBridgeSmoke(entry: try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(smoke, name: "nativeUI")
        configuration.userContentController.addUserScript(WKUserScript(source: NativeUITrust.bootstrap(trustedURL: html, enabled: true)!, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        smoke.webView = WKWebView(frame: .zero, configuration: configuration)
        smoke.webView.navigationDelegate = smoke
        smoke.webView.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
        let deadline = Date().addingTimeInterval(20)
        while !smoke.finished && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
        precondition(smoke.finished, "WebKit桥接超时")
        precondition(smoke.failure == nil, smoke.failure ?? "")
        precondition(smoke.received.count == 4, "总结成功、旧网关、无效版本与有效版本均须通过真实桥接")
        print("Native title WebKit bridge passed: 4 receipts")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(entry) { _, error in
            if let error { self.failure = String(describing: (error as NSError).userInfo); self.finished = true }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "snapshot",
              let snapshot = body["snapshot"] as? [String: Any] else { return }
        do {
            // 与 NativeUIBridge 相同的 Foundation 序列化边界；旧实现会在这里 SIGABRT。
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            struct ReceiptSnapshot: Decodable { var commandResults: [NativeCommandResult] }
            let results = try JSONDecoder().decode(ReceiptSnapshot.self, from: data).commandResults
            for result in results {
                precondition(result.fieldKey == "rename-1")
                if result.id == "valid-revision" {
                    precondition(result.ok && result.fieldRevision == 7)
                } else {
                    precondition(result.fieldRevision == nil, "关联键不能凭空生成字段版本")
                    if result.id == "summary" { precondition(result.ok && result.value == "候选名称") }
                    else { precondition(!result.ok && result.error != nil) }
                }
                received.insert(result.id)
            }
            if received.count == 4 { finished = true }
        } catch { failure = error.localizedDescription; finished = true }
    }
}
