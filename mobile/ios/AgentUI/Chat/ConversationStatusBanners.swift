import SwiftUI

struct ConversationStatusBanners: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversation: Conversation
    var body: some View {
        VStack(spacing: 10) {
            if conversation.readOnly || session.device(conversation.deviceID)?.connection != .connected || session.device(conversation.deviceID)?.enabled != true {
                HStack {
                    Label(preferences.text("历史可读，当前不可交互", "History is readable; interaction is unavailable"), systemImage: "lock")
                        .font(.subheadline)
                    Spacer()
                    Button(preferences.text("重新连接", "Reconnect")) { Task { await session.reconnectConversation(conversation.id) } }
                        .font(.subheadline.bold()).frame(minHeight: 44)
                }
                .padding(12).background(AgentTheme.code, in: .rect(cornerRadius: 14))
            }
            if session.selectedConversationID == conversation.id, session.canReopenPendingRequests, session.activeQuestionID == nil, session.activeApprovalID == nil {
                HStack {
                    Label(session.hasDeferredQuestion ? preferences.text("Codex 需要你的回答", "Codex needs your answer") : preferences.text("有待处理请求", "Pending requests"), systemImage: "questionmark.bubble")
                    Spacer()
                    Button(session.hasDeferredQuestion ? preferences.text("继续回答", "Continue answering") : preferences.text("查看待处理请求", "View pending requests")) { session.reopenPendingRequests() }
                }
                .font(.subheadline).padding(12).background(.orange.opacity(0.08), in: .rect(cornerRadius: 14))
            }
        }
    }
}
