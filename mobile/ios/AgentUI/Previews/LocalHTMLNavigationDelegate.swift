import WebKit

@MainActor
final class LocalHTMLNavigationDelegate: NSObject, WKNavigationDelegate {
    var lastDocument = ""
    private let openURL: (URL) -> Void

    init(openURL: @escaping (URL) -> Void) { self.openURL = openURL }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.scheme == "about", navigationAction.navigationType == .other {
            return .allow
        } else {
            if navigationAction.navigationType == .linkActivated,
               ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                openURL(url)
            }
            return .cancel
        }
    }
}
