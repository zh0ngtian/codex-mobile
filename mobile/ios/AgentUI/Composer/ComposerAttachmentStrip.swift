import SwiftUI

struct ComposerAttachmentStrip: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var failurePresented = false
    @State private var failureMessage = ""

    var body: some View {
        if !session.composer.attachments.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(session.composer.attachments) { item in
                        ComposerAttachmentCard(item: item, preview: { preview(item) }, remove: { remove(item.id) })
                    }
                }
                .padding(.horizontal, 4).padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            .alert(preferences.text("附件读取失败", "Attachment could not be read"), isPresented: $failurePresented) {
                Button(preferences.text("知道了", "OK"), role: .cancel) { }
            } message: { Text(failureMessage) }
        }
    }

    private func remove(_ id: UUID) { session.removeAttachment(id) }
    private func preview(_ item: AttachmentItem) {
        if item.state == .failed {
            failureMessage = item.error ?? preferences.text("读取失败，请移除后重新添加。", "Read failed. Remove it and add it again.")
            failurePresented = true
        } else {
            session.previewAttachment(item.id)
        }
    }
}
