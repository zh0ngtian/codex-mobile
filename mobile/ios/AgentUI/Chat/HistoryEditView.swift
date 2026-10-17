import SwiftUI

struct HistoryEditView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let message: ChatMessage
    @State private var confirming = false
    @State private var text = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(preferences.text("修改原消息", "Edit original message"), text: $text, axis: .vertical)
                .lineLimit(3...10).font(.body).textFieldStyle(.plain)
                .padding(14).background(AgentTheme.card, in: .rect(cornerRadius: 15))
                .accessibilityIdentifier("history.editor")
            if !message.attachments.isEmpty { FlowAttachmentSummary(attachments: message.attachments) }
            Text(preferences.text("重发不会撤销已经发生的文件修改、命令或外部操作。", "Resending does not undo file changes, commands, or external actions."))
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button(preferences.text("取消", "Cancel"), action: session.cancelHistoryEdit)
                Spacer()
                Button(preferences.text("保存并重发", "Save and resend"), action: save)
                    .buttonStyle(.borderedProminent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && message.attachments.isEmpty)
            }.frame(minHeight: 44)
        }
        .padding(14)
        .background(AgentTheme.code, in: .rect(cornerRadius: 20))
        .onAppear { text = session.historyEdit?.text ?? message.text }
        .onChange(of: text) { session.historyEdit?.text = text }
        .confirmationDialog(preferences.text("删除后续并重发？", "Delete later messages and resend?"), isPresented: $confirming, titleVisibility: .visible) {
            Button(preferences.text("删除后续并重发", "Delete later messages and resend"), role: .destructive) { _ = session.submitHistoryEdit(confirmed: true) }
            Button(preferences.text("取消", "Cancel"), role: .cancel) { }
        } message: { Text(preferences.text("更早的历史会保留。已发生的外部操作不会撤销。", "Earlier history is kept. External actions already performed are not undone.")) }
    }
    private func save() {
        if session.historyEditHasFollowing() { confirming = true }
        else { _ = session.submitHistoryEdit() }
    }
}
