import SwiftUI

struct QuestionSubmitBar: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let request: QuestionRequest

    var body: some View {
        VStack(spacing: 10) {
            if !request.isValid {
                Text(preferences.text("所有问题均需有效回答", "A valid answer is required for every question"))
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            Button(action: submit) {
                HStack(spacing: 8) {
                    if request.submitting { ProgressView().tint(.white) }
                    Text(request.submitting ? preferences.text("正在提交…", "Submitting…") : preferences.text("提交回答", "Submit answers"))
                        .font(.body)
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!request.isValid || request.submitting)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.bar)
    }

    private func submit() { Task { await session.submitAnswers(request.id) } }
}
