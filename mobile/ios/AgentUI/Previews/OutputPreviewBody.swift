import SwiftUI

struct OutputPreviewBody: View {
    @Environment(AppPreferences.self) private var preferences
    let item: OutputItem
    let loaded: LoadedPreview
    let selectedTab: PreviewTab

    var body: some View {
        switch item.kind {
        case .text, .code:
            PreviewCodeView(source: source, targetLine: item.line)
        case .markdown:
            if selectedTab == .source { PreviewCodeView(source: source, targetLine: item.line) }
            else { MarkdownPreviewView(source: source) }
        case .html:
            if selectedTab == .source { PreviewCodeView(source: source, targetLine: item.line) }
            else { LocalHTMLPreview(source: source) }
        case .mermaid:
            if selectedTab == .source { PreviewCodeView(source: source, targetLine: item.line) }
            else { MermaidPreviewView(source: source) }
        case .image:
            if let source = loaded.webImageSource, let html = NativeImageData.webImageHTML(source, title: item.name) {
                NativeHTMLWebView(html: html, scrollEnabled: true, interactive: true, onOpenLink: { _ in })
            } else if let image = loaded.image { ImageOutputPreview(image: image, name: item.name) }
        case .video:
            if let url = loaded.videoURL { VideoOutputPreview(url: url) }
        case .binary:
            ContentUnavailableView {
                Label(preferences.text("无法预览此文件", "Preview unavailable"), systemImage: "doc.zipper")
            } description: {
                Text(preferences.text("这是二进制文件。点击右上角下载按钮保存后打开。", "This is a binary file. Use Download in the toolbar to save and open it."))
            }
        case .web:
            WebOutputPreview(address: source)
        }
    }

    private var source: String { String(data: loaded.data, encoding: .utf8) ?? item.content }
}
