import SwiftUI

struct ComposerAttachmentCard: View {
    @Environment(AppPreferences.self) private var preferences
    let item: AttachmentItem
    let preview: () -> Void
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: preview) {
                HStack(spacing: 9) {
                    AttachmentThumbnail(item: item).frame(width: 42, height: 42)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.name).font(.body).lineLimit(1)
                        Text(status).font(.body).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .frame(width: 105, alignment: .leading)
                }
                .padding(.leading, 10).padding(.vertical, 10)
            }
            .buttonStyle(.plain).disabled(item.state == .processing)
            .foregroundStyle(AgentTheme.ink).tint(AgentTheme.ink)
            .accessibilityHint(item.state == .failed ? preferences.text("查看完整错误信息", "Read the full error") : preferences.text("打开附件预览", "Open attachment preview"))
            Button(preferences.text("移除附件", "Remove attachment"), systemImage: "xmark.circle.fill", action: remove)
                .labelStyle(.iconOnly).font(.body).foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
        }
        .background(AgentTheme.card, in: .rect(cornerRadius: 15))
        .overlay { RoundedRectangle(cornerRadius: 15).strokeBorder(AgentTheme.line) }
    }

    private var status: String {
        switch item.state {
        case .ready: preferences.text("点击预览", "Tap to preview")
        case .processing: preferences.text("正在处理…", "Processing…")
        case .failed: item.error ?? preferences.text("读取失败，请移除后重试", "Read failed; remove and try again")
        }
    }
}
