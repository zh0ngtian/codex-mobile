import SwiftUI

struct NativeMessageView: View {
    let message: NativeMessage
    let store: NativeUIStore
    @ScaledMetric(relativeTo: .body) private var bodySize = 16
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if message.role == "user" {
                HStack(alignment: .top) {
                    Spacer(minLength: 52)
                    Text(message.text).font(.system(size: bodySize * store.snapshot.fontScale)).textSelection(.enabled)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(NativePalette.bubble, in: .rect(cornerRadius: 16))
                }.padding(.horizontal, 24)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    if let status = message.status { Text(status).font(.caption).foregroundStyle(.secondary) }
                    NativeMarkdownView(text: message.text, scale: store.snapshot.fontScale)
                    if let blocks = message.blocks {
                        ForEach(blocks) { item in NativePanelItemView(item: item, store: store) }
                    }
                    if let actions = message.actions {
                        ViewThatFits(in: .horizontal) {
                            HStack { ForEach(actions) { item in NativePanelItemView(item: item, store: store) } }
                            VStack(alignment: .leading) { ForEach(actions) { item in NativePanelItemView(item: item, store: store) } }
                        }
                    }
                }.padding(.horizontal, 24)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .contain)
    }
}
