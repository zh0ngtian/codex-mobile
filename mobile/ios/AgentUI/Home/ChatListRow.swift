import SwiftUI

struct ChatListRow: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversation: Conversation
    var indented = false

    var body: some View {
        Button { session.open(conversation.id) } label: {
            HStack(alignment: .top, spacing: 8) {
                UnreadIndicator(isUnread: conversation.isUnread).padding(.top, 6)
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .top, spacing: 4) {
                        Text(conversation.title)
                            .font(AgentTheme.body)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if showsStatusMarker {
                            if showsRunningSpinner {
                                ProgressView().progressViewStyle(.circular).controlSize(.mini)
                                    .tint(.secondary).frame(width: 12, height: 12).padding(.top, 3)
                                    .accessibilityLabel(preferences.text("正在执行", "Working"))
                                    .accessibilityIdentifier("sidebar.running.\(conversation.id)")
                            } else {
                                Circle().fill(statusColor).frame(width: 6, height: 6)
                                    .padding(.top, 6)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    if statusTitle != nil || pendingCount > 0 {
                        HStack(spacing: 4) {
                            if hasTrailingActivity { Spacer(minLength: 0) }
                            if let statusTitle { Text(statusTitle).lineLimit(1) }
                            if !hasTrailingActivity { Spacer(minLength: 0) }
                            if pendingCount > 0 {
                                Label("\(pendingCount)", systemImage: "hand.raised.fill")
                                    .foregroundStyle(.orange)
                            }
                        }
                        .font(AgentTheme.sidebarDetail)
                        .foregroundStyle(.secondary)
                    }
                    if session.selectedDeviceID == nil, let device = session.device(conversation.deviceID) {
                        Text(device.name)
                            .font(AgentTheme.sidebarDetail)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.leading, conversation.isPinned ? 0 : 5)
            .padding(.trailing, 5)
            .padding(.leading, indented ? 20 : 0)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(session.selectedConversationID == conversation.id ? Color.accentColor.opacity(0.09) : .clear, in: .rect(cornerRadius: 9))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu { ConversationMenuActions(conversationID: conversation.id).tint(AgentTheme.ink) }
        .accessibilityLabel(accessibilityTitle)
        .accessibilityValue(conversation.isPinned ? preferences.text("已关注", "Following") : "")
        .accessibilityIdentifier("sidebar.conversation.\(conversation.id)")
    }

    private var pendingCount: Int {
        session.approvals.filter { $0.conversationID == conversation.id }.count + session.questions.filter { $0.conversationID == conversation.id }.count
    }
    private var hasTrailingActivity: Bool { conversation.phase == .running }
    private var showsRunningSpinner: Bool {
        conversation.phase == .running && session.device(conversation.deviceID).map { $0.enabled && $0.connection == .connected } == true
    }
    private var showsStatusMarker: Bool {
        conversation.phase != .idle || session.device(conversation.deviceID)?.connection != .connected
    }
    private var statusColor: Color {
        if let device = session.device(conversation.deviceID) {
            if !device.enabled || device.connection == .paused { return .secondary }
            if device.connection == .failed { return .red }
            if device.connection == .connecting { return .orange }
        }
        switch conversation.phase {
        case .running: return .green
        case .waitingApproval, .waitingAnswer: return .orange
        case .idle: return conversation.isUnread ? .accentColor : .secondary.opacity(0.4)
        }
    }
    private var statusTitle: String? {
        if conversation.readOnly { return preferences.text("只读", "Read only") }
        if let device = session.device(conversation.deviceID) {
            if !device.enabled || device.connection == .paused { return preferences.text("已暂停", "Paused") }
            if device.connection == .failed { return preferences.text("连接失败", "Disconnected") }
            if device.connection == .connecting { return preferences.text("连接中", "Connecting") }
        }
        switch conversation.phase {
        case .running: return nil
        case .waitingApproval: return preferences.text("待审批", "Approval needed")
        case .waitingAnswer: return preferences.text("待回答", "Answer needed")
        case .idle: return nil
        }
    }
    private var accessibilityTitle: String {
        var parts = [conversation.title]
        if let statusTitle { parts.append(statusTitle) }
        let unreadTitle = preferences.text("未读", "Unread")
        if conversation.isUnread && statusTitle != unreadTitle { parts.append(unreadTitle) }
        if pendingCount > 0 { parts.append(preferences.text("\(pendingCount) 项待处理", "\(pendingCount) pending")) }
        return parts.joined(separator: preferences.text("，", ", "))
    }
}
