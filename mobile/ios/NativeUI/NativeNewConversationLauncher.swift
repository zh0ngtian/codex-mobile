import SwiftUI

/// 独立的新会话入口，不读取或绑定被隐藏会话的草稿。
struct NativeNewConversationLauncher: View {
    let store: NativeUIStore
    var body: some View {
        HStack(spacing: 0) {
            Button { store.startNewConversation(presentation: .attachments) } label: {
                Image(systemName: "plus").font(.system(size: 23)).frame(width: 44, height: 48)
            }
            .accessibilityLabel(store.label("新对话附件", "New Conversation Attachment"))
            .accessibilityIdentifier("native-new-conversation-attachment")
            .disabled(!canLaunch)
            Button { store.startNewConversation() } label: {
                Text(store.awaitingNewConversation ? store.label("正在新建对话…", "Preparing Conversation…") : store.label("向 Codex 提问", "Ask Codex"))
                    .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale, weight: .semibold))
                    .foregroundStyle(NativePalette.secondary).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            }.accessibilityIdentifier("native-new-conversation-launcher").disabled(!canLaunch)
            Button {
                if store.awaitingNewConversation { store.cancelComposerPresentation() }
                else { store.startNewConversation() }
            } label: {
                Image(systemName: store.awaitingNewConversation ? "xmark" : "arrow.up").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 28, height: 28).background(NativePalette.accent, in: .circle).frame(width: 44, height: 48)
            }
            .accessibilityLabel(store.awaitingNewConversation ? store.label("取消新对话", "Cancel New Conversation") : store.label("新对话", "New Conversation"))
            .accessibilityIdentifier("native-new-conversation-action")
            .disabled(!canLaunch && !store.awaitingNewConversation)
        }.buttonStyle(.plain).padding(.horizontal, 5)
            .background(NativePalette.controlFill, in: .capsule)
            .background(.ultraThinMaterial, in: .capsule)
            .overlay { Capsule().stroke(.primary.opacity(0.18), lineWidth: 0.5) }
            .padding(.horizontal, NativeVisualMetrics.composerInset).padding(.top, 8).padding(.bottom, 6)
    }
    private var canLaunch: Bool { store.snapshot.ready && store.snapshot.pending != true && !store.awaitingNewConversation }
}
