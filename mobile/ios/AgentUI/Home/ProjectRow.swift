import SwiftUI

struct ProjectRow: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let name: String
    @State private var contentHeight: CGFloat = 0
    @State private var revealedHeight: CGFloat = 0
    @State private var contentsVisible = false
    @State private var revealID: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if session.searchText.isEmpty { session.toggleProject(name) }
            } label: {
                HStack(spacing: 8) {
                    ProjectFolderIcon(isExpanded: expanded)
                    Text(displayName)
                        .font(AgentTheme.body)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if !expanded { SidebarActivitySummary(conversations: conversations).fixedSize() }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 14)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(preferences.text("\(expanded ? "收起" : "展开")项目 \(displayName)", "\(expanded ? "Collapse" : "Expand") project \(displayName)"))
            VStack(alignment: .leading, spacing: 0) {
                if session.loadingProjects.contains(name) {
                    ProgressView().controlSize(.small).tint(AgentTheme.ink.opacity(0.6))
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .accessibilityIdentifier("sidebar.project.loading.\(name)")
                } else if session.projectErrors.contains(name) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(preferences.text("加载失败", "Load failed")).foregroundStyle(.secondary)
                        Button(preferences.text("重试", "Retry"), systemImage: "arrow.clockwise") { session.retryProject(name) }
                            .frame(minHeight: 36)
                    }
                    .font(AgentTheme.small)
                    .padding(.leading, 10)
                } else {
                    ForEach(conversations) { conversation in
                        ChatListRow(conversation: conversation, indented: true)
                    }
                    if session.projectHasMore(name) {
                        Button { session.loadMoreProject(name) } label: {
                            Text(preferences.text("加载更多", "Load more"))
                                .font(AgentTheme.small)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                                .padding(.leading, 10)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(!session.canLoadMoreProject(name))
                        .accessibilityIdentifier("sidebar.more.\(name)")
                    }
                    if conversations.isEmpty {
                        Text(preferences.text("暂无会话", "No conversations"))
                            .accessibilityIdentifier("sidebar.project.empty.\(name)")
                            .font(AgentTheme.small)
                            .foregroundStyle(.tertiary)
                            .padding(.leading, 10)
                            .padding(.vertical, 10)
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                contentHeight = height
                if expanded {
                    updateReveal()
                }
            }
            .opacity(contentsVisible ? 1 : 0)
            .animation(contentsVisible && !reduceMotion ? .easeOut(duration: 0.18) : nil, value: contentsVisible)
            .frame(height: revealedHeight, alignment: .top)
            .clipped()
            .allowsHitTesting(expanded)
            .accessibilityElement(children: .contain)
            .accessibilityHidden(!expanded)
        }
        .onChange(of: expanded) { updateReveal() }
        .onAppear { revealedHeight = expanded ? contentHeight : 0; contentsVisible = expanded }
    }

    private func updateReveal() {
        // 先拉开空间再渐显会话；收起立即隐藏文字，避免后续项目标题与退出文字重叠。
        let id = UUID()
        revealID = id
        contentsVisible = false
        let target = expanded ? contentHeight : 0
        if reduceMotion {
            revealedHeight = target; contentsVisible = expanded; revealID = nil
        } else {
            withAnimation(.easeInOut(duration: 0.25), completionCriteria: .removed) {
                revealedHeight = target
            } completion: {
                guard revealID == id else { return }
                revealID = nil
                contentsVisible = expanded
            }
        }
    }

    private var displayName: String { session.projectDisplayName(name) }
    private var expanded: Bool { session.projectIsExpanded(name) }
    private var conversations: [Conversation] { session.projectConversations(name) }

}
