import SwiftUI

struct MessageAttachmentCards: View {
    let attachments: [AttachmentItem]
    var body: some View {
        OutputCards(items: attachments.compactMap(AttachmentPreviewMapper.output))
    }
}
