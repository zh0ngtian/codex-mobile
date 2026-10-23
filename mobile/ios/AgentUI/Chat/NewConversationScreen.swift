import SwiftUI

struct NewConversationScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        ScrollView {
            VStack(spacing: 30) {
                NewTaskTargets()
                if let error = session.persistenceError {
                    Text(preferences.runtimeText(error)).font(.body).foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 20).padding(.top, 10)
        }
        .background(AgentTheme.page)

    }
}
