import SwiftUI

struct NativeDraftAttachmentView: View {
    let attachment: NativeAttachment
    let store: NativeUIStore
    var body: some View {
        HStack(spacing: 8) {
            if let source = attachment.imageURL {
                NativeImageView(source: source, title: attachment.name).frame(width: 56, height: 56).clipped()
            } else { Image(systemName: symbol).foregroundStyle(.secondary) }
            VStack(alignment: .leading, spacing: 4) {
                Text(attachment.name).lineLimit(2).modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption))
                if let detail = attachment.detail { Text(detail).foregroundStyle(.secondary).modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption2)) }
            }.frame(maxWidth: 130, alignment: .leading)
            if let command = attachment.command {
                Button(store.label("预览 \(attachment.name)", "Preview \(attachment.name)"), systemImage: "play.circle") { store.perform(command) }
                    .labelStyle(.iconOnly).font(.title3).frame(minWidth: 44, minHeight: 44)
            }
            Button(store.label("移除 \(attachment.name)", "Remove \(attachment.name)"), systemImage: "xmark") { store.command("attachment.remove", ["id": .string(attachment.id)]) }
                .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44).disabled(!store.composerCanEdit)
        }.padding(8).background(.quaternary, in: .rect(cornerRadius: 16))
    }
    private var symbol: String {
        if attachment.type?.hasPrefix("video/") == true { return "video" }
        if attachment.type?.hasPrefix("audio/") == true { return "waveform" }
        return "doc"
    }
}
