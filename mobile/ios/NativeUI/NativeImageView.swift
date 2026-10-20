import SwiftUI

struct NativeImageView: View {
    let source: String
    var title = ""
    var previewSource: String? = nil
    @State private var localImage: UIImage?
    @State private var localFailed = false
    @State private var previewOpen = false
    @Environment(\.locale) private var locale

    var body: some View {
        Button(action: openPreview) {
            Group {
                if NativeImageData.needsWebRenderer(previewSource ?? source, title: title), let html = NativeImageData.webImageHTML(source, title: title) {
                    NativeHTMLWebView(html: html, scrollEnabled: false, interactive: false, onOpenLink: { _ in })
                        .frame(height: 240).allowsHitTesting(false)
                } else if let localImage {
                    Image(uiImage: localImage).renderingMode(.original).resizable().scaledToFit()
                } else if let url = NativeImageData.remoteURL(source) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image): image.renderingMode(.original).resizable().scaledToFit()
                        case .failure: Label(label("缩略图加载失败，点按查看原图", "Thumbnail unavailable. Tap to view the original."), systemImage: "arrow.clockwise")
                        default: ProgressView()
                        }
                    }
                } else if localFailed {
                    Label(label("无法读取图片", "Unable to read image"), systemImage: "photo.badge.exclamationmark")
                } else { ProgressView() }
            }
            .frame(maxWidth: .infinity, minHeight: 44, maxHeight: 320)
            .clipShape(.rect(cornerRadius: 12))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary).tint(.primary)
        .accessibilityLabel(title.isEmpty ? label("查看图片", "View Image") : "\(label("查看图片", "View Image")) \(title)")
        .task(id: source, loadImage)
        .sheet(isPresented: $previewOpen) {
            NativeImagePreview(source: previewSource ?? source, title: title)
        }
    }

    private func loadImage() async {
        localImage = nil
        localFailed = false
        guard source.hasPrefix("data:"), !NativeImageData.needsWebRenderer(previewSource ?? source, title: title) else { return }
        if let data = NativeImageData.data(for: source), let image = UIImage(data: data) { localImage = image }
        else { localFailed = true }
    }

    private func openPreview() {
        previewOpen = true
    }
    private func label(_ chinese: String, _ english: String) -> String { locale.identifier.hasPrefix("zh") ? chinese : english }
}
