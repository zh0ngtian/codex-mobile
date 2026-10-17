import SwiftUI

struct ConversationHeader: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.scenePhase) private var scenePhase
    let conversationID: UUID?
    @State private var usagePresented = false
    private var conversation: Conversation? { conversationID.flatMap(session.conversation) }
    var body: some View {
        HStack(spacing: 10) {
            GlassIconButton(title: preferences.text("会话列表", "Conversation list"), symbol: "line.3.horizontal.decrease") {
                session.sidebarVisible = true
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(conversation?.title ?? preferences.text("新对话", "New conversation"))
                    .font(AgentTheme.body).lineLimit(1)
                if let conversation {
                    Text("\(conversation.project ?? preferences.text("无项目", "No project")) · \(session.device(conversation.deviceID)?.name ?? "")")
                        .font(AgentTheme.caption).foregroundStyle(.secondary).lineLimit(1)
                } else { Text("Codex").font(AgentTheme.small).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 0) {
                Button { usagePresented.toggle() } label: {
                    Circle().trim(from: 0, to: max(0.02, conversation?.usage?.contextRemaining.map { 1 - $0 } ?? 0.02))
                        .stroke(AgentTheme.ink, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .background { Circle().stroke(AgentTheme.line, lineWidth: 2) }
                        .frame(width: 17, height: 17).frame(width: 38, height: 44)
                }
                .accessibilityLabel(preferences.text("用量与额度", "Usage and limits"))
                .accessibilityIdentifier("header.usage")
                .popover(isPresented: $usagePresented) {
                    UsagePopover(conversationID: conversationID,
                                 deviceID: conversation?.deviceID ?? session.composer.deviceID,
                                 dismiss: { usagePresented = false })
                }
                InlineIconButton(title: preferences.text("新建对话", "New conversation"), symbol: "square.and.pencil") { session.beginNewConversation() }
                Menu(preferences.text("会话操作", "Conversation actions"), systemImage: "ellipsis") {
                    if let conversationID { ConversationMenuActions(conversationID: conversationID) }
                    else {
                        Button(preferences.text("保存草稿", "Save draft"), systemImage: "square.and.arrow.down") { _ = session.saveDraft() }
                            .disabled(!session.canSaveDraft)
                    }
                }
                .tint(AgentTheme.ink)
                .labelStyle(.iconOnly).frame(width: 36, height: 44)
                .accessibilityIdentifier("conversation.actions")
            }
            .padding(.horizontal, 3)
            .background(.regularMaterial, in: .capsule)
            .overlay { Capsule().strokeBorder(AgentTheme.line, lineWidth: 0.6) }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12).padding(.top, 2).padding(.bottom, 12)
        .background(AgentTheme.page.opacity(0.97))
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
