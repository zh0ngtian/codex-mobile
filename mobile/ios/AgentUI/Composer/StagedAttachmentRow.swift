import SwiftUI

struct StagedAttachmentRow: View {
    @Environment(AppPreferences.self) private var preferences
    let item: AttachmentItem
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            AttachmentThumbnail(item: item).frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name).font(.body).lineLimit(2)
                if item.state == .processing {
                    Text(preferences.text("正在处理…", "Processing…")).font(.body).foregroundStyle(.secondary)
                } else if item.state == .failed {
                    Text(item.error ?? preferences.text("读取失败", "Read failed")).font(.body).foregroundStyle(.secondary)
                } else {
                    Text(preferences.text("已就绪", "Ready")).font(.body).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            Button(preferences.text("移除附件", "Remove attachment"), systemImage: "xmark.circle.fill", action: remove)
                .labelStyle(.iconOnly).buttonStyle(.borderless).frame(width: 44, height: 44)
        }
    }
}
