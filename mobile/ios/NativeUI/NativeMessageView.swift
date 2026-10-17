import SwiftUI

struct NativeMessageView: View {
    let message: NativeMessage
    let store: NativeUIStore
    @ScaledMetric(relativeTo: .caption) private var statusSize = 14
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if message.role == "user" {
                if let editor = message.historyEdit {
                    NativeHistoricalMessageEditor(editor: editor, messageID: message.id, store: store)
                        .padding(.horizontal, NativeVisualMetrics.pageInset)
                } else {
                    HStack(alignment: .top) {
                        Spacer(minLength: 96)
                        NativeMarkdownView(text: message.text, scale: store.snapshot.fontScale, store: store, compact: true)
                            .padding(.horizontal, 13).padding(.vertical, 12)
                            .foregroundStyle(NativePalette.bubbleText)
                            .background(NativePalette.bubble, in: .rect(cornerRadius: NativeVisualMetrics.bubbleRadius))
                    }.padding(.horizontal, NativeVisualMetrics.pageInset)
                }
                if let blocks = message.blocks, !blocks.isEmpty {
                    VStack(alignment: .trailing, spacing: 8) {
                        ForEach(blocks) { item in NativePanelItemView(item: item, store: store, scope: .message(message.id)) }
                    }.padding(.leading, 76).padding(.trailing, 16)
                }
            } else {
                VStack(alignment: .leading, spacing: NativeTextRhythm.standardGap) {
                    if let status = message.status {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(status).font(.system(size: statusSize * store.snapshot.fontScale, weight: .semibold)).foregroundStyle(NativePalette.statusText)
                            Divider()
                        }
                    }
                    NativeMarkdownView(text: message.text, scale: store.snapshot.fontScale, store: store)
                    if let blocks = message.blocks {
                        ForEach(blocks) { item in NativePanelItemView(item: item, store: store, scope: .message(message.id)) }
                    }
                    if message.timestamp != nil || !(message.actions ?? []).isEmpty {
                        NativeMessageFooter(message: message, store: store)
                    }
                }.padding(.horizontal, NativeVisualMetrics.pageInset)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .contain)
            .contextMenu {
                ForEach(message.historyEdit == nil ? message.actions ?? [] : []) { item in
                    NativePanelItemView(item: item, store: store, scope: .message(message.id))
                }
            }
    }
}
