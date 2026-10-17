import SwiftUI

struct NewConversationScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        ScrollView {
            VStack(spacing: 30) {
                NewTaskTargets()
                VStack(spacing: 12) {
                    Image(systemName: "sparkle").font(.largeTitle).foregroundStyle(.secondary)
                    Text(preferences.text("有什么可以帮你？", "What can I help with?")).font(.body)
                    Text(preferences.text("选择机器与项目，然后输入任务。", "Choose a computer and project, then describe your task."))
                        .font(.body).foregroundStyle(.secondary)
                }
                .padding(.top, 100)
                if let error = session.persistenceError {
                    Text(preferences.runtimeText(error)).font(.body).foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 20).padding(.top, 10)
        }
        .background(AgentTheme.page)
        .safeAreaInset(edge: .top, spacing: 0) { ConversationHeader(conversationID: nil) }
        .safeAreaInset(edge: .bottom, spacing: 0) { ComposerBar(conversationID: nil) }
        .toolbarVisibility(.hidden, for: .navigationBar)
    }
}
