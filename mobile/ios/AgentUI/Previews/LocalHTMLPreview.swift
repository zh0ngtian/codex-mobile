import SwiftUI
import WebKit

struct LocalHTMLPreview: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    let source: String

    func makeCoordinator() -> LocalHTMLNavigationDelegate {
        LocalHTMLNavigationDelegate { url in openURL(url) }
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let document = isolatedDocument
        guard context.coordinator.lastDocument != document else { return }
        context.coordinator.lastDocument = document
        webView.loadHTMLString(document, baseURL: nil)
    }

    private var isolatedDocument: String {
        let background = colorScheme == .dark ? "#151515" : "#faf9f7"
        let foreground = colorScheme == .dark ? "#f5f3ef" : "#242321"
        return """
        <!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta charset="utf-8">
        <style>
        :root { color-scheme: \(colorScheme == .dark ? "dark" : "light"); }
        body { margin: 0; padding: 30px 24px; background: \(background); color: \(foreground); font: -apple-system-body; line-height: 1.65; overflow-wrap: anywhere; }
        h1 { font: -apple-system-large-title; font-weight: 750; line-height: 1.2; letter-spacing: -1px; margin: 18px 0 24px; }
        .eyebrow { font-size: 11px; letter-spacing: 2px; color: #a06b53; font-weight: 700; }
        .card { padding: 22px; border: 1px solid #9b887933; border-radius: 20px; margin: 28px 0; }
        a { color: #a05b40; } pre { overflow-x: auto; } img { max-width: 100%; }
        </style></head><body>\(source)</body></html>
        """
    }
}
