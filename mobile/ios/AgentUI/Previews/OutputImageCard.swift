import SwiftUI

struct OutputImageCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let item: OutputItem
    var previewImage: UIImage? = nil
    @State private var image: UIImage?
    @State private var loadedItem: OutputItem?
    @State private var retainedPreviewImage: UIImage?
    @State private var failed = false

    private var displayedImage: UIImage? {
        if loadedItem == item, let image { return image }
        return previewImage ?? (loadedItem == item ? retainedPreviewImage : nil)
    }

    var body: some View {
        Button { session.previewItem = item } label: {
            VStack(spacing: 8) {
                if let source = item.remoteURL, NativeImageData.needsWebRenderer(source, title: item.name),
                   let html = NativeImageData.webImageHTML(source, title: item.name) {
                    NativeHTMLWebView(html: html, scrollEnabled: false, interactive: false, onOpenLink: { _ in })
                        .frame(height: 180).allowsHitTesting(false)
                } else if let image = displayedImage {
                    Image(uiImage: image).renderingMode(.original).resizable().scaledToFit().frame(maxHeight: 180)
                } else if loadedItem == item && failed {
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
        .task(id: item) {
            if loadedItem != item {
                image = nil; failed = false
                loadedItem = item; retainedPreviewImage = previewImage
            } else if let previewImage { retainedPreviewImage = previewImage }
            await load()
        }
        .onChange(of: previewImage) { _, preview in
            guard loadedItem == item, let preview else { return }
            retainedPreviewImage = preview
        }
    }

    private func load() async {
        do {
            let preview = try await PreviewLoader.load(item)
            guard !Task.isCancelled else { return }
            image = preview.image
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
        }
    }
}
