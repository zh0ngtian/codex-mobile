import UIKit
import WebKit

/// 仅内置首页可以请求打开固定的 HTTPS 安装页；系统安装由 Safari 交接。
final class CodexMobileAppUpdateBridge: NSObject, WKScriptMessageHandler {
    private let installURL: URL?

    private init(installURL: URL?) {
        self.installURL = installURL
    }

    static func configure(_ webView: WKWebView) {
        let info = Bundle.main.infoDictionary ?? [:]
        let install = info["CodexMobileInstallURL"] as? String ?? ""
        let config: [String: String] = [
            "version": info["CFBundleShortVersionString"] as? String ?? "0.2.0",
            "apiUrl": info["CodexMobileUpdateURL"] as? String ?? "",
            "installUrl": install,
            "bundleId": Bundle.main.bundleIdentifier ?? "",
            "teamId": info["CodexMobileTeamID"] as? String ?? "",
            "applicationIdentifier": info["CodexMobileApplicationIdentifier"] as? String ?? ""
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: config),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = """
        (() => {
          if (location.protocol !== 'file:' || window !== window.top) return;
          const config = \(json);
          window.CodexMobileAppUpdate = {
            ...config, appVersion: () => config.version,
            installOta: (url) => {
              if (!config.installUrl.startsWith('https://') || url !== config.installUrl)
                throw new Error('iOS OTA 安装地址未配置或不受信任');
              window.webkit.messageHandlers.appUpdate.postMessage(url);
            }
          };
        })();
        """
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        webView.configuration.userContentController.add(
            CodexMobileAppUpdateBridge(installURL: URL(string: install)), name: "appUpdate"
        )
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "appUpdate", message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, frameURL.isFileURL,
              frameURL.standardizedFileURL == Bundle.main.bundleURL.appendingPathComponent("index.html").standardizedFileURL,
              let requested = message.body as? String,
              let installURL, installURL.scheme == "https",
              installURL.user == nil, installURL.password == nil,
              installURL.query == nil, installURL.fragment == nil,
              installURL.host != nil, requested == installURL.absoluteString else { return }
        UIApplication.shared.open(installURL, options: [:]) { opened in
            guard !opened else { return }
            message.webView?.evaluateJavaScript("""
            window.dispatchEvent(new CustomEvent('codex-mobile-app-update', {
              detail: {phase:'error', error:'无法打开 Safari 安装页，请稍后重试'}
            }));
            """, completionHandler: nil)
        }
    }
}
