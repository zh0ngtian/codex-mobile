import SwiftUI

/// 保留真实工具、文件、审批入口的命令身份；媒体已在 AgentApp 产出卡片中显示。
struct LiveBusinessBlocks: View {
    @Environment(AppSession.self) private var session
    let messageID: UUID

    var body: some View {
        if let message = session.nativeMessage(messageID), let store = session.nativeStore {
            VStack(alignment: .leading, spacing: 10) {
                ForEach((message.blocks ?? []).compactMap(filtered)) { item in
                    if item.kind == "markdown" || item.kind == "text" {
                        AssistantBody(text: item.text ?? item.value ?? "")
                    } else if item.kind == "code" || item.kind == "diff" {
                        CodeCard(code: item.text ?? item.value ?? "", language: item.kind == "diff" ? "diff" : item.title ?? "Code")
                    } else {
                        NativePanelItemView(item: item, store: store, scope: .message(message.id))
                            .padding(12)
                            .background(AgentTheme.card, in: .rect(cornerRadius: 16))
                            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(AgentTheme.line) }
                    }
                }
            }
            .contextMenu {
                ForEach(message.actions ?? []) { item in
                    NativePanelItemView(item: item, store: store, scope: .message(message.id))
                }
            }
        }
    }

    private func filtered(_ item: NativePanelItem) -> NativePanelItem? {
        if ["image", "video", "html", "source"].contains(item.kind) { return nil }
        var result = item
        if let children = item.children { result.children = children.compactMap(filtered) }
        return result
    }
}
