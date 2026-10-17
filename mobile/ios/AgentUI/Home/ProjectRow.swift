import SwiftUI

struct ProjectRow: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let name: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if session.searchText.isEmpty { session.toggleProject(name) }
            } label: {
                HStack(spacing: 8) {
                    ProjectFolderIcon(isExpanded: expanded)
                    Text(displayName)
                        .font(AgentTheme.body.bold())
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if !expanded && conversations.contains(where: \.isUnread) {
                        UnreadIndicator(isUnread: true)
                    }
                    Spacer(minLength: 0)
                    if !expanded { SidebarActivitySummary(conversations: conversations) }
                }
                .padding(.leading, 14)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(preferences.text("\(expanded ? "收起" : "展开")项目 \(displayName)", "\(expanded ? "Collapse" : "Expand") project \(displayName)"))
            if expanded {
                if session.loadingProjects.contains(name) {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 38)
                } else if session.projectErrors.contains(name) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(preferences.text("加载失败", "Load failed")).foregroundStyle(.secondary)
                        Button(preferences.text("重试", "Retry"), systemImage: "arrow.clockwise") { session.retryProject(name) }
                            .frame(minHeight: 36)
                    }
                    .font(AgentTheme.small.weight(.medium))
                    .padding(.leading, 10)
                } else {
                    ForEach(conversations) { conversation in
                        ChatListRow(conversation: conversation, indented: true)
                    }
                    if session.projectHasMore(name) {
                        Button { session.loadMoreProject(name) } label: {
                            Text(preferences.text("加载更多", "Load more"))
                                .font(AgentTheme.small.weight(.medium))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                                .padding(.leading, 10)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("sidebar.more.\(name)")
                    }
                    if conversations.isEmpty {
                        Text(preferences.text("暂无会话", "No conversations"))
                            .font(AgentTheme.small)
                            .foregroundStyle(.tertiary)
                            .padding(.leading, 10)
                            .padding(.vertical, 10)
                    }
                }
            }
        }
    }

    private var displayName: String { session.projectDisplayName(name) }
    private var expanded: Bool { session.projectIsExpanded(name) }
    private var conversations: [Conversation] { session.projectConversations(name) }

}
