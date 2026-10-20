import SwiftUI
import WebKit

/// 只显示内容，使用临时数据域，不安装任何业务脚本或消息处理器。
struct NativeHTMLWebView: UIViewRepresentable {
    let html: String
    var scrollEnabled = true
    var interactive = true
    var onOpenLink: (URL) -> Void
    func makeCoordinator() -> NativeHTMLNavigation { NativeHTMLNavigation(onOpenLink: onOpenLink) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        view.scrollView.isScrollEnabled = scrollEnabled
        view.isUserInteractionEnabled = interactive
        context.coordinator.onOpenLink = onOpenLink
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        view.loadHTMLString("""
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>:root{color-scheme:light dark}body{margin:12px;font:16px -apple-system,sans-serif;overflow-wrap:anywhere}img,svg,video{max-width:100%;height:auto}pre{overflow:auto}</style>
        </head><body>\(html)</body></html>
        """, baseURL: nil)
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: NativeHTMLNavigation) {
        view.stopLoading()
        view.navigationDelegate = nil
    }
}
