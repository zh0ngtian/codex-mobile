import SwiftUI

struct AttachmentThumbnail: View {
    let item: AttachmentItem
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9).fill(.tint.opacity(0.08))
            if item.state == .processing {
                ProgressView().controlSize(.small)
            } else if item.state == .failed {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(.secondary)
            } else if item.kind == .image, let asset = item.assetName {
                Image(asset).resizable().scaledToFill()
            } else if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: item.kind.symbol).foregroundStyle(.tint)
            }
        }
        .clipShape(.rect(cornerRadius: 9)).accessibilityHidden(true)
        .task(id: item, loadThumbnail)
    }

    private func loadThumbnail() async {
        guard item.kind == .image, item.state == .ready else { return }
        if let output = AttachmentPreviewMapper.output(for: item) { image = try? await PreviewLoader.load(output).image }
    }
}
