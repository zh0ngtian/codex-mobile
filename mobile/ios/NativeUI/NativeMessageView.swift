import SwiftUI

struct NativeMessageView: View {
    let message: NativeMessage
    let store: NativeUIStore
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    @ScaledMetric(relativeTo: .caption) private var statusSize = 14
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if message.role == "user" {
                HStack(alignment: .top) {
                    Spacer(minLength: 52)
                    Text(message.text).font(.system(size: bodySize * store.snapshot.fontScale, weight: .semibold)).lineSpacing(5).textSelection(.enabled)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(NativePalette.bubble, in: .rect(cornerRadius: 16))
                }.padding(.leading, 24).padding(.trailing, 21)
                if let blocks = message.blocks, !blocks.isEmpty {
                    VStack(alignment: .trailing, spacing: 8) {
                        ForEach(blocks) { item in NativePanelItemView(item: item, store: store, scope: .message(message.id)) }
                    }.padding(.leading, 76).padding(.trailing, 21)
                }
            } else {
                VStack(alignment: .leading, spacing: NativeTextRhythm.standardGap) {
                    if let status = message.status {
                        Text(status).font(.system(size: statusSize * store.snapshot.fontScale)).foregroundStyle(.secondary)
                            .padding(.bottom, NativeTextRhythm.statusToBodyGap - NativeTextRhythm.standardGap)
                    }
                    NativeMarkdownView(text: message.text, scale: store.snapshot.fontScale, store: store)
                    if let blocks = message.blocks {
                        ForEach(blocks) { item in NativePanelItemView(item: item, store: store, scope: .message(message.id)) }
                    }
                    if let actions = message.actions, !actions.isEmpty {
                        ViewThatFits(in: .horizontal) {
                            HStack { ForEach(actions) { item in NativePanelItemView(item: item, store: store, scope: .message(message.id)) } }
                            VStack(alignment: .leading) { ForEach(actions) { item in NativePanelItemView(item: item, store: store, scope: .message(message.id)) } }
                        }
                    }
                }.padding(.horizontal, 24)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .contain)
            .contextMenu {
                ForEach(message.actions ?? []) { item in
                    NativePanelItemView(item: item, store: store, scope: .message(message.id))
                }
            }
    }
}
