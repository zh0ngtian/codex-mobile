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
            ForEach(request.decisions) { decision in
                Button(role: decision.isDestructive ? .destructive : nil) {
                    submit(decision)
                } label: {
                    Label(decision.title(using: preferences), systemImage: decision.symbol)
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 3)
                }
                .buttonStyle(.bordered)
                .disabled(request.submitting)
            }
        }
    }

    private func submit(_ decision: ApprovalDecision) {
        Task { await session.submitApproval(request.id, decision: decision) }
    }
}
