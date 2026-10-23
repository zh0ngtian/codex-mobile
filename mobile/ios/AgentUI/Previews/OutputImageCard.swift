import SwiftUI

struct OutputImageCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let item: OutputItem
    var previewImage: UIImage? = nil
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Button { session.previewItem = item } label: {
            VStack(spacing: 8) {
                if let source = item.remoteURL, NativeImageData.needsWebRenderer(source, title: item.name),
                   let html = NativeImageData.webImageHTML(source, title: item.name) {
                    NativeHTMLWebView(html: html, scrollEnabled: false, interactive: false, onOpenLink: { _ in })
                        .frame(height: 180).allowsHitTesting(false)
                } else if let image = image ?? previewImage {
                    Image(uiImage: image).renderingMode(.original).resizable().scaledToFit().frame(maxHeight: 180)
                } else if failed {
                    Image(systemName: "photo.badge.exclamationmark").font(.title).frame(height: 90)
                } else { ProgressView().frame(height: 90) }
            }
            .frame(maxWidth: .infinity)
            .clipShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .foregroundStyle(AgentTheme.ink)
        .tint(AgentTheme.ink)
        .accessibilityLabel(item.name)
        .accessibilityHint(preferences.text("打开图片预览", "Open image preview"))
        .task(id: item.id, load)
    }

    private func load() async {
        do {
            let preview = try await PreviewLoader.load(item)
            guard !Task.isCancelled else { return }
            image = preview.image
        } catch { failed = true }
    }
}
