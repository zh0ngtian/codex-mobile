import SwiftUI

struct QuestionSubmitBar: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let request: QuestionRequest

    var body: some View {
        HStack(spacing: 12) {
            Button(preferences.text("稍后回答", "Later")) { session.postponeQuestion() }
                .accessibilityIdentifier("question.later")
                .frame(minHeight: 44)
                .disabled(request.submitting)
            Spacer(minLength: 0)
            Button(action: submit) {
                HStack(spacing: 8) {
                    if request.submitting { ProgressView().tint(AgentTheme.page) }
                    Text(request.submitting ? preferences.text("正在提交…", "Submitting…") : preferences.text("提交回答", "Submit answers"))
                        .font(.body)
                }
            }
            .foregroundStyle(AgentTheme.page)
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
            .frame(minHeight: 44)
            .accessibilityIdentifier("question.submit")
            .disabled(!request.isValid || request.submitting)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private func submit() { Task { await session.submitAnswers(request.id) } }
}
