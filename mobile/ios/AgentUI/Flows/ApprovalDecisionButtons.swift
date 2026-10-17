import SwiftUI

struct ApprovalDecisionButtons: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let request: ApprovalRequest

    var body: some View {
        VStack(spacing: 8) {
            if request.submitting {
                ProgressView(preferences.text("正在提交决定…", "Submitting decision…"))
                    .font(.subheadline)
                    .frame(minHeight: 44)
            }
            ForEach(request.choices) { choice in
                Button(role: choice.decision?.isDestructive == true ? .destructive : nil) {
                    submit(choice.id)
                } label: {
                    Label(choice.title, systemImage: choice.decision?.symbol ?? "questionmark.circle")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 3)
                }
                .buttonStyle(.bordered)
                .disabled(request.submitting || choice.disabled)
            }
        }
    }

    private func submit(_ choiceID: UUID) {
        Task { await session.submitApproval(request.id, choiceID: choiceID) }
    }
}
