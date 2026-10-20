import SwiftUI

struct SidechatMenuActions: View {
    @Environment(AppSession.self) private var session
    var body: some View {
        ForEach(session.nativeSnapshot.sidechatActions ?? []) { action in
            Button(role: action.command?.name == "sidechat.close" ? .destructive : nil) {
                session.perform(action.command)
            } label: {
                Label(action.title ?? "Sidechat", systemImage: symbol(action.command?.name))
            }
            .disabled(action.disabled == true)
            .accessibilityIdentifier(action.id)
        }
    }
    private func symbol(_ command: String?) -> String {
        switch command {
        case "sidechat.create": "plus.bubble"
        case "sidechat.return": "arrow.uturn.backward"
        case "sidechat.close": "xmark.bubble"
        default: "bubble.left.and.bubble.right"
        }
    }
}
