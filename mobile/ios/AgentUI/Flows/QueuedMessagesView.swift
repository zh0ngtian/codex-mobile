import SwiftUI

struct QueuedMessagesView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversationID: UUID

    var body: some View {
        if let conversation = session.conversation(conversationID), !conversation.queue.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(preferences.text("待发送消息", "Message queue"), systemImage: "rectangle.stack")
                        .font(.body)
                    Spacer()
                    Text(conversation.queue.count, format: .number)
                        .font(.body.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if !conversation.canModify {
                    Label(preferences.text("此会话为只读，队列操作已停用", "This conversation is read only. Queue actions are unavailable."), systemImage: "lock")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                ForEach(conversation.queue) { message in
                    QueuedMessageCard(conversationID: conversationID, message: message)
                }
            }
        }
    }
}
