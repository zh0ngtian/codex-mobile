import SwiftUI

struct QuestionAnswerField: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let requestID: UUID
    let question: AgentQuestion
    let submitting: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(question.title)
                    .font(.headline)
                if !question.detail.isEmpty {
                    Text(question.detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text(preferences.text("必填", "Required"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(question.options) { option in
                QuestionOptionButton(title: option.title, detail: option.detail, selected: answer.optionID == option.id && !answer.custom) {
                    choose(option.id)
                }
            }
            if !question.options.isEmpty && question.allowsCustom {
                QuestionOptionButton(title: preferences.text("其他回答", "Custom answer"), selected: answer.custom, action: chooseCustom)
            }
            if question.options.isEmpty || answer.custom {
                if question.secret {
                    SecureField(preferences.text("输入保密回答", "Enter a secret answer"), text: textBinding)
                        .textContentType(nil)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(14)
                        .frame(minHeight: 50)
                        .background(AgentTheme.card, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityLabel(question.title)
                } else {
                    TextField(preferences.text("输入你的回答…", "Enter your answer…"), text: textBinding, axis: .vertical)
                        .lineLimit(3...8)
                        .padding(14)
                        .frame(minHeight: 80, alignment: .topLeading)
                        .background(AgentTheme.card, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityLabel(question.title)
                }
            }
        }
        .disabled(submitting)
    }

    private var answer: QuestionAnswer {
        session.question(requestID)?.answers[question.id] ?? QuestionAnswer()
    }

    private var textBinding: Binding<String> {
        Binding(get: { answer.text }, set: updateText)
    }

    private func updateText(_ text: String) {
        var updated = answer
        updated.text = text
        updated.custom = true
        session.setAnswer(requestID: requestID, questionID: question.id, answer: updated)
    }

    private func choose(_ optionID: UUID) {
        var updated = answer
        updated.optionID = optionID
        updated.custom = false
        session.setAnswer(requestID: requestID, questionID: question.id, answer: updated)
    }

    private func chooseCustom() {
        var updated = answer
        updated.optionID = nil
        updated.custom = true
        session.setAnswer(requestID: requestID, questionID: question.id, answer: updated)
    }
}
