import SwiftUI

/// 页面导航交给系统，保留原来的真实会话操作和用量弹层。
struct ConversationHeader: ViewModifier {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.scenePhase) private var scenePhase
    let conversationID: UUID?
    @State private var usagePresented = false
    private var conversation: Conversation? { conversationID.flatMap(session.conversation) }
    private var title: String { conversation?.title ?? preferences.text("新对话", "New conversation") }
    private var subtitle: String {
        guard let conversation else { return "Codex" }
        return "\(conversation.project.map { session.projectTitle(for: $0) } ?? preferences.text("无项目", "No project")) · \(session.device(conversation.deviceID)?.name ?? "")"
    }
    private var contextUsed: Double? {
        guard let remaining = conversation?.usage?.contextRemaining, remaining.isFinite else { return nil }
        return min(1, max(0, 1 - remaining))
    }
    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .modifier(ConversationSubtitle(title: title, subtitle: subtitle))
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        if session.nativeSnapshot.sidechatActive == true {
                            session.perform(session.nativeSnapshot.sidechatActions?.first { $0.command?.name == "sidechat.return" }?.command)
                        } else { session.sidebarVisible = true }
                    } label: { Image(systemName: session.nativeSnapshot.sidechatActive == true ? "chevron.left" : "line.3.horizontal").font(.system(size: 16, weight: .regular)).frame(width: 16, height: 16) }
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(session.nativeSnapshot.sidechatActive == true ? preferences.text("返回主聊天", "Return to main chat") : preferences.text("会话列表", "Conversation list"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 0) {
                        Button { usagePresented.toggle() } label: {
                            NativeUsageIcon()
                                .frame(width: 16, height: 16)
                        }
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(preferences.text("用量与额度", "Usage and limits"))
                        .accessibilityIdentifier("header.usage")
                        .accessibilityValue(contextUsed.map { "已用 \(Int(($0 * 100).rounded()))%" } ?? "暂无上下文用量")
                        .popover(isPresented: $usagePresented) {
                            UsagePopover(conversationID: conversationID, deviceID: conversation?.deviceID ?? session.composer.deviceID, dismiss: { usagePresented = false })
                        }
                        Button { session.beginNewConversation() } label: { Image(systemName: "square.and.pencil").fontWeight(.regular).frame(width: 16, height: 16) }
                            .frame(width: 44, height: 44)
                            .accessibilityLabel(preferences.text("新建对话", "New conversation"))
                            .accessibilityIdentifier("header.newConversation")
                        Menu {
                            if let conversationID { ConversationMenuActions(conversationID: conversationID) }
                            else {
                                Button(preferences.text("保存草稿", "Save draft"), systemImage: "square.and.arrow.down") { _ = session.saveDraft() }
                                    .disabled(!session.canSaveDraft)
                            }
                        } label: { Image(systemName: "ellipsis").fontWeight(.regular).frame(width: 16, height: 16) }
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(preferences.text("会话操作", "Conversation actions"))
                        .accessibilityIdentifier("conversation.actions")
                    }
                    .font(.system(size: 16, weight: .regular))
                    .buttonStyle(.plain)
                }
            }
            .tint(AgentTheme.ink)
        .onChange(of: session.selectedConversationID) { usagePresented = false }
        .onChange(of: session.selectedDeviceID) { usagePresented = false }
        .onChange(of: session.currentDevice?.id) { usagePresented = false }
        .onChange(of: session.sidebarVisible) { if session.sidebarVisible { usagePresented = false } }
        .onChange(of: session.settingsPresented) { if session.settingsPresented { usagePresented = false } }
        .onChange(of: session.draftsPresented) { if session.draftsPresented { usagePresented = false } }
        .onChange(of: session.previewItem?.id) { if session.previewItem != nil { usagePresented = false } }
        .onChange(of: scenePhase) { if scenePhase != .active { usagePresented = false } }
    }
}

private struct ConversationSubtitle: ViewModifier {
    let title: String
    let subtitle: String
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) { content.navigationSubtitle(subtitle) }
        else {
            content.toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) { Text(title).font(.body); Text(subtitle).font(.body).foregroundStyle(.secondary) }
                        .lineLimit(1)
                }
            }
        }
    }
}

struct ConversationComposerInset: ViewModifier {
    let conversationID: UUID?
    func body(content: Content) -> some View {
        // 编辑器使用稳定的系统 inset 承载焦点和键盘；外观由原生玻璃控件负责。
        content.safeAreaInset(edge: .bottom, spacing: 0) { ComposerBar(conversationID: conversationID) }
    }
}
