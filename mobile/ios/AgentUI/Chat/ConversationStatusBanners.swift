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
            if let request = session.questions.first(where: { $0.conversationID == conversation.id }), session.activeQuestionID != request.id {
                HStack {
                    Label(preferences.text("Codex 需要你的回答", "Codex needs your answer"), systemImage: "questionmark.bubble")
                    Spacer()
                    Button(preferences.text("继续回答", "Continue answering")) { session.activeQuestionID = request.id }
                        .disabled(!session.canInteract(conversation.id))
                }
                .font(.subheadline).padding(12).background(.orange.opacity(0.08), in: .rect(cornerRadius: 14))
            }
        }
    }
}
