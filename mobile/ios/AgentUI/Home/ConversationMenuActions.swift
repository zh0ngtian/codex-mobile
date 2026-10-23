import SwiftUI

struct ConversationMenuActions: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversationID: UUID

    var body: some View {
        if session.selectedConversationID == conversationID, session.nativeSnapshot.sidechatActive == true {
            SidechatMenuActions()
        } else if let conversation = session.conversation(conversationID) {
            Button {
                session.togglePin(conversationID)
            } label: {
                Label(conversation.isPinned ? preferences.text("取消置顶", "Unpin") : preferences.text("置顶", "Pin"), systemImage: conversation.isPinned ? "pin.slash" : "pin")
            }
            .disabled(menuBusy)
            Button {
                Task { await session.refreshConversation(conversationID) }
            } label: {
                Label(preferences.text("刷新", "Refresh"), systemImage: "arrow.clockwise")
            }
            .disabled(menuBusy)
            Button {
                session.clone(conversationID)
            } label: {
                Label(preferences.text("复制会话", "Duplicate conversation"), systemImage: "plus.square.on.square")
            }
            .disabled(menuBusy || !conversation.canModify)
            Button {
                if ConversationIDClipboard.copy(session.rawConversationID(conversationID), write: Clipboard.copy) {
                    session.toast = preferences.text("已复制会话 ID", "Conversation ID copied")
                } else {
                    session.reportError(preferences.text("真实会话 ID 尚未就绪，请刷新后重试。", "The conversation ID is not ready. Refresh and try again."))
                }
            } label: {
                Label(preferences.text("复制会话 ID", "Copy conversation ID"), systemImage: "number")
            }
            .disabled(menuBusy || session.rawConversationID(conversationID)?.isEmpty != false)
            Button {
                session.renameTargetID = conversationID
            } label: {
                Label(preferences.text("重命名", "Rename"), systemImage: "pencil")
            }
            .disabled(menuBusy || !conversation.canModify)
            Button(role: .destructive) {
                if !session.archive(conversationID) { session.archiveTargetID = conversationID }
            } label: {
                Label(preferences.text("归档", "Archive"), systemImage: "archivebox")
            }
            .disabled(menuBusy || !conversation.canModify)
            if session.selectedConversationID == conversationID {
                Section("Sidechat") { SidechatMenuActions() }
            }
        }
    }

    private var menuBusy: Bool { session.menuBusyID != nil }
}
