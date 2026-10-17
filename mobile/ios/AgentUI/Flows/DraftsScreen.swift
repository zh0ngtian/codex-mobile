import SwiftUI

struct DraftsScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if session.draftReadError {
                        ContentUnavailableView {
                            Label(preferences.text("草稿读取失败", "Could not read drafts"), systemImage: "exclamationmark.folder")
                        } description: {
                            Text(preferences.text("已保存的草稿没有被删除。请重新读取。", "Your saved drafts have been kept. Try reading them again."))
                        } actions: {
                            Button(preferences.text("重新读取", "Retry"), action: reload)
                                .buttonStyle(.borderedProminent)
                                .frame(minHeight: 44)
                        }
                    } else if session.drafts.isEmpty {
                        ContentUnavailableView {
                            Label(preferences.text("暂无草稿", "No drafts yet"), systemImage: "doc.text")
                        } description: {
                            Text(preferences.text("在新对话菜单中保存草稿，稍后继续。", "Save a draft from the new conversation menu to continue later."))
                        }
                    } else {
                        Text(preferences.text("恢复会还原正文、附件、设备、项目和发送配置，不会自动发送。", "Restoring brings back the text, attachments, device, project, and send settings. You can review them before sending."))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.bottom, 2)
                        ForEach(session.drafts) { draft in
                            DraftCard(draft: draft)
                        }
                    }
                    if let error = session.persistenceError {
                        FlowErrorBanner(message: error)
                    }
                }
                .padding(16)
            }
            .background(AgentTheme.settings)
            .navigationTitle(preferences.text("草稿箱", "Drafts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(preferences.text("关闭草稿箱", "Close drafts"), systemImage: "xmark", action: close)
                        .labelStyle(.iconOnly)
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
        }
    }

    private func reload() { session.reloadDrafts() }
    private func close() { dismiss() }
}
