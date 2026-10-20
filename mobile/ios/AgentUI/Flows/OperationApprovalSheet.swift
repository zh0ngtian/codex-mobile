import SwiftUI

struct OperationApprovalSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let requestID: UUID

    var body: some View {
        NavigationStack {
            ScrollView {
                if let request = session.approval(requestID) {
                    VStack(alignment: .leading, spacing: 24) {
                        ApprovalRequestDetails(request: request)
                        ApprovalDecisionButtons(request: request)
                        Text(preferences.text("作出决定后才能继续此任务。", "Choose a decision to continue this task."))
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .padding(20)
                } else {
                    ContentUnavailableView(preferences.text("审批已处理", "Approval resolved"), systemImage: "checkmark.shield")
                }
            }
            .background(AgentTheme.page)
            .navigationTitle(preferences.text("操作审批", "Operation approval"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .interactiveDismissDisabled()
        .presentationDragIndicator(.hidden)
    }
}
