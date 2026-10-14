import SwiftUI

struct NativeImageView: View {
    let source: String
    var title = ""
    var previewSource: String? = nil
    @State private var localImage: UIImage?
    @State private var localFailed = false
    @State private var previewOpen = false
    @State private var retry = 0
    @Environment(\.locale) private var locale

    var body: some View {
        Button(action: openPreview) {
            Group {
                if let localImage {
                    Image(uiImage: localImage).resizable().scaledToFit()
                } else if let url = NativeImageData.remoteURL(source) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFit()
                        case .failure: Label(label("图片加载失败，点按重试", "Image failed to load. Tap to retry."), systemImage: "arrow.clockwise")
                        default: ProgressView()
                        }
                    }.id(retry)
                } else if localFailed {
                    Label(label("无法读取图片", "Unable to read image"), systemImage: "photo.badge.exclamationmark")
                } else { ProgressView() }
            }
            .frame(maxWidth: .infinity, minHeight: 44, maxHeight: 320)
            .clipShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title.isEmpty ? label("查看图片", "View Image") : "\(label("查看图片", "View Image")) \(title)")
        .task(id: source, loadImage)
        .sheet(isPresented: $previewOpen) {
            NativeImagePreview(source: previewSource ?? source, title: title)
        }
    }

    private func loadImage() async {
        localImage = nil
        localFailed = false
        guard source.hasPrefix("data:") else { return }
        if let data = NativeImageData.data(for: source), let image = UIImage(data: data) { localImage = image }
        else { localFailed = true }
    }

    private func openPreview() {
        if localFailed { retry += 1; return }
        previewOpen = true
    }
    private func label(_ chinese: String, _ english: String) -> String { locale.identifier.hasPrefix("zh") ? chinese : english }
}
