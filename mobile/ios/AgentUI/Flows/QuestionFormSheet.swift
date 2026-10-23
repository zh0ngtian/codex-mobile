import SwiftUI

struct QuestionFormSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let requestID: UUID

    var body: some View {
        NavigationStack {
            ScrollView {
                if let request = session.question(requestID) {
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(preferences.text("Codex 需要你的回答", "Codex needs your answer"), systemImage: "text.bubble.fill")
                                .font(.body)
                            Text(preferences.text("请回答所有问题后提交。你也可以稍后继续。", "Answer every question to submit. You can also continue later."))
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                        ForEach(request.questions) { question in
                            QuestionAnswerField(requestID: requestID, question: question, submitting: request.submitting)
                        }
                        if let error = request.error {
                            FlowErrorBanner(message: error)
                        }
                    }
                    .padding(20)
                } else {
                    ContentUnavailableView(preferences.text("问题已处理", "Questions resolved"), systemImage: "checkmark.bubble")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(AgentTheme.page)
            .navigationTitle(preferences.text("回答问题", "Answer questions"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(preferences.text("稍后回答", "Later"), action: postpone)
                        .accessibilityIdentifier("question.later")
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(session.question(requestID)?.submitting == true)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let request = session.question(requestID) {
                    QuestionSubmitBar(request: request)
                }
            }
        }
        .interactiveDismissDisabled()
    }

    private func postpone() { session.postponeQuestion() }
}
