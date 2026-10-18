import SwiftUI

struct AttachmentThumbnail: View {
    let item: AttachmentItem
    @State private var image: UIImage?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                RoundedRectangle(cornerRadius: 9).fill(Color.primary.opacity(0.05))
                if item.state == .processing {
                    ProgressView().controlSize(.small)
                } else if item.state == .failed {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.secondary)
                } else if item.kind == .image, let asset = item.assetName {
                    Image(asset).renderingMode(.original).resizable().scaledToFill()
                } else if let image {
                    Image(uiImage: image).renderingMode(.original).resizable().scaledToFill()
                } else {
                    Image(systemName: item.kind.symbol).foregroundStyle(.secondary)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipShape(.rect(cornerRadius: 9))
        }
        .accessibilityHidden(true)
        .task(id: item, loadThumbnail)
    }

    private func loadThumbnail() async {
        guard item.kind == .image, item.state == .ready else { return }
        if let output = AttachmentPreviewMapper.output(for: item) { image = try? await PreviewLoader.load(output).image }
    }
}
