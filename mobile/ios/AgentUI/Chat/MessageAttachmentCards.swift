import SwiftUI

struct MessageAttachmentCards: View {
    let attachments: [AttachmentItem]
    var previewImages: [UIImage?] = []
    var body: some View {
        VStack(spacing: 8) {
            ForEach(Array(attachments.enumerated()), id: \.element.id) { index, attachment in
                if let output = AttachmentPreviewMapper.output(for: attachment) {
                    if output.kind == .image {
                        OutputImageCard(item: output, previewImage: previewImages.indices.contains(index) ? previewImages[index] : nil)
                    } else { OutputCards(items: [output], isAttachment: true) }
                }
            }
        }
    }
}
