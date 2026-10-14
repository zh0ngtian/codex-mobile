import SwiftUI

struct NativeHTMLPreview: View {
    let html: String
    let title: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.openURL) private var openURL
    var body: some View {
        NavigationStack {
            NativeHTMLWebView(html: html) { url in
                guard ["http", "https", "file", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") || url.scheme == nil else { return }
                openURL(url)
            }
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(locale.identifier.hasPrefix("zh") ? "完成" : "Done") { dismiss() } } }
        }
    }
}
