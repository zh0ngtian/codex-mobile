import WebKit

@MainActor
final class NativeHTMLNavigation: NSObject, WKNavigationDelegate {
    var loadedHTML: String?
    var onOpenLink: (URL) -> Void
    init(onOpenLink: @escaping (URL) -> Void) { self.onOpenLink = onOpenLink }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == true, action.request.url?.absoluteString == "about:blank" {
            decisionHandler(.allow)
        } else {
            if action.navigationType == .linkActivated, let url = action.request.url {
                onOpenLink(url)
            }
            decisionHandler(.cancel)
        }
    }
}
