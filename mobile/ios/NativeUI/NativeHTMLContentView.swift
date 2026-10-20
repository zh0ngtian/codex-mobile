import SwiftUI

struct NativeHTMLContentView: View {
    let html: String
    let title: String
    @Environment(\.openURL) private var openURL
    @Environment(\.locale) private var locale
    @State private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NativeHTMLWebView(html: html, scrollEnabled: false, onOpenLink: followLink)
                .frame(height: 320).clipShape(.rect(cornerRadius: 12))
            Button(locale.identifier.hasPrefix("zh") ? "全屏查看" : "View Full Screen", systemImage: "arrow.up.left.and.arrow.down.right") { expanded = true }
                .frame(minHeight: 44)
        }
        .sheet(isPresented: $expanded) { NativeHTMLPreview(html: html, title: title) }
    }
    private func followLink(_ url: URL) {
        guard ["http", "https", "file", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") || url.scheme == nil else { return }
        openURL(url)
    }
}
