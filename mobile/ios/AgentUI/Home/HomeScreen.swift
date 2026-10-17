import SwiftUI

struct SidebarConversationList: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var followingExpanded = true

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if !session.pendingOtherDevices.isEmpty { pendingDevices }
            if !followed.isEmpty {
                Button { followingExpanded.toggle() } label: {
                    HStack(spacing: 4) {
                        UnreadIndicator(isUnread: !followingExpanded && followed.contains(where: \.isUnread))
                        Text(preferences.text("关注", "Following"))
                        Image(systemName: followingExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption2.bold())
                        Spacer(minLength: 0)
                        if !followingExpanded { SidebarActivitySummary(conversations: followed) }
                    }
                    .font(AgentTheme.sectionTitle)
                    .frame(minHeight: 36)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                if followingExpanded {
                    ForEach(followed) { conversation in ChatListRow(conversation: conversation) }
                }
            }
            if !visibleProjects.isEmpty {
                sectionTitle(preferences.text("项目", "Projects"))
                ForEach(visibleProjects, id: \.self) { name in ProjectRow(name: name) }
            }
            if !ungroupedSearchResults.isEmpty {
                ForEach(ungroupedSearchResults) { conversation in ChatListRow(conversation: conversation) }
            }
            if session.hasMoreConversations && !session.searchText.isEmpty {
                Button(preferences.text("加载更多搜索结果", "Load more search results"), systemImage: "arrow.down") { session.loadMoreConversations() }
                    .font(AgentTheme.small).frame(minHeight: 38)
            }
            switch navigationState {
            case .loading:
                ProgressView(preferences.text("正在加载…", "Loading…"))
                    .font(AgentTheme.small).frame(maxWidth: .infinity, minHeight: 44)
                    .accessibilityIdentifier("sidebar.loading")
            case .failed(let error):
                VStack(alignment: .leading, spacing: 7) {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                    Button(preferences.text("重试", "Retry"), systemImage: "arrow.clockwise") { session.retryNavigation() }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("sidebar.retry")
                }
                .font(AgentTheme.small).padding(.vertical, 12)
            case .empty:
                VStack(alignment: .leading, spacing: 7) {
                    Image(systemName: session.searchText.isEmpty ? "bubble.left" : "magnifyingglass")
                        .font(.title3)
                    Text(session.searchText.isEmpty ? preferences.text("暂无会话", "No conversations") : preferences.text("没有匹配的会话", "No matches"))
                        .font(AgentTheme.body.weight(.medium))
                }
                .foregroundStyle(.secondary)
                .padding(.vertical, 18)
            case .populated: EmptyView()
            }
        }
    }

    private var navigationState: SidebarNavigationState {
        SidebarNavigationState(loading: session.navigationLoading, error: session.navigationError,
                               empty: followed.isEmpty && visibleProjects.isEmpty && ungroupedSearchResults.isEmpty)
    }

    private var followed: [Conversation] { session.visibleConversations.filter(\.isPinned) }
    private var ungroupedSearchResults: [Conversation] {
        guard !session.searchText.isEmpty else { return [] }
        return session.visibleConversations.filter { !$0.isPinned && $0.project == nil }
    }
    private var visibleProjects: [String] {
        if session.searchText.isEmpty { return session.scopedProjects }
        return session.scopedProjects.filter { session.projectDisplayName($0).localizedStandardContains(session.searchText) || !session.projectConversations($0).isEmpty }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(AgentTheme.sectionTitle)
            .foregroundStyle(.secondary)
            .padding(.top, 10)
            .padding(.bottom, 2)
    }

    private var pendingDevices: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(session.pendingOtherDevices) { device in
                Button {
                    session.selectListDevice(device.id)
                    session.sidebarVisible = true
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(device.name, systemImage: "hand.raised.fill")
                            .lineLimit(1)
                        Text(preferences.text("\(session.pendingCount(for: device.id)) 项待处理", "\(session.pendingCount(for: device.id)) pending"))
                    }
                    .font(AgentTheme.small.weight(.medium))
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(7)
                    .background(.orange.opacity(0.09), in: .rect(cornerRadius: 9))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(preferences.text("查看 \(device.name) 的待处理请求", "View pending requests on \(device.name)"))
            }
        }
        .padding(.bottom, 7)
    }
}

struct SidebarActivitySummary: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversations: [Conversation]

    var body: some View {
        HStack(spacing: 4) {
            if conversations.contains(where: { $0.phase == .running }) {
                Circle().fill(.green).frame(width: 5, height: 5)
            }
            if pendingCount > 0 {
                Text("\(pendingCount)")
                    .font(AgentTheme.sidebarDetail.bold())
                    .foregroundStyle(.orange)
            }
        }
        .accessibilityLabel(preferences.text("\(pendingCount) 项待处理，\(unreadCount) 个未读", "\(pendingCount) pending, \(unreadCount) unread"))
    }

    private var unreadCount: Int { conversations.filter(\.isUnread).count }
    private var pendingCount: Int {
        let ids = Set(conversations.map(\.id))
        return session.approvals.filter { ids.contains($0.conversationID) }.count + session.questions.filter { ids.contains($0.conversationID) }.count
    }
}
