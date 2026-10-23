import SwiftUI

struct QuestionFormSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var contentHeight: CGFloat = 260
    @State private var actionsHeight: CGFloat = 68
    let requestID: UUID

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if let request = session.question(requestID) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 8) {
                            Label(preferences.text("需要回答", "Answer needed"), systemImage: "text.bubble")
                            Spacer(minLength: 0)
                            if request.questions.count > 1 {
                                Text(request.questions.count, format: .number)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .font(.body)
                        .accessibilityIdentifier("question.header")
                        ForEach(request.questions) { question in
                            QuestionAnswerField(requestID: requestID, question: question, submitting: request.submitting, showTitle: request.questions.count > 1)
                        }
                        if let error = request.error { FlowErrorBanner(message: error) }
                    }
                    .padding(14)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
                } else {
                    Text(preferences.text("问题已处理", "Questions resolved"))
                        .padding(14)
                }
            }
            .accessibilityIdentifier("question.content")
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .clipped()
            .contentShape(Rectangle())
            if let request = session.question(requestID) {
                QuestionSubmitBar(request: request)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { actionsHeight = $0 }
                    .background(AgentTheme.card)
                    .zIndex(1)
            }
        }
        .background(AgentTheme.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(AgentTheme.line) }
        .padding(16)
        .background(AgentTheme.page)
        .presentationDetents([.height(min(max(contentHeight + actionsHeight + 32, 220), 520))])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled()
    }
}
