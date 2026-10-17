import SwiftUI

struct FlowAttachmentSummary: View {
    @Environment(AppPreferences.self) private var preferences
    let attachments: [AttachmentItem]

    var body: some View {
        if !attachments.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label(preferences.text("\(attachments.count) 个附件", "\(attachments.count) attachments"), systemImage: "paperclip")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(attachments) { attachment in
                    Label(attachment.name, systemImage: attachment.kind.symbol)
                        .font(.subheadline)
                        .lineLimit(2)
                        .foregroundStyle(attachment.state == .failed ? Color.red : Color.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}
