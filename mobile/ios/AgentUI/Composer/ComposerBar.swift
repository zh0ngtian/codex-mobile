import SwiftUI

struct ComposerBar: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let conversationID: UUID?
    @State private var activeSheet: ComposerSheet?
    @State private var showReasoning = false
    @State private var selectedMention = 0
    @State private var mentionsDismissed = false
    @FocusState private var focused: Bool
    private var expanded: Bool { focused || session.composer.text.contains("\n") || !session.composer.attachments.isEmpty }
    private var mentionQuery: String? {
        guard !mentionsDismissed, let last = session.composer.text.split(whereSeparator: \.isWhitespace).last, last.hasPrefix("@") else { return nil }
        return String(last.dropFirst())
    }
    private var candidates: [NativeOption] {
        mentionQuery == nil ? [] : session.mentionOptions
    }
    var body: some View {
        @Bindable var session = session
        AgentGlassGroup {
            VStack(spacing: 8) {
                if !candidates.isEmpty {
                    MentionCandidates(candidates: candidates, selected: selectedMention, choose: chooseMention)
                }
                if showReasoning {
                    ReasoningControl(openModels: { present(.model) })
                        .background(OutsideTapDismiss { showReasoning = false })
                        .transition(.opacity)
                }
                VStack(spacing: 2) {
                    if !session.composer.attachments.isEmpty { ComposerAttachmentStrip() }
                    HStack(spacing: 0) {
                        if !expanded { InlineIconButton(title: preferences.text("添加附件", "Add attachment"), symbol: "plus") { present(.attachments) } }
                        TextField(preferences.text("向 Codex 提问", "Ask Codex"), text: $session.composer.text, axis: .vertical)
                            .font(AgentTheme.body)
                            .lineLimit(1...6)
                            .focused($focused)
                            .submitLabel(.send)
                            .onSubmit(submit)
                            .onKeyPress(keys: [.upArrow, .downArrow, .return, .tab, .escape], action: handleKey)
                            .frame(minHeight: expanded ? 42 : 47)
                            .padding(.horizontal, expanded ? 12 : 2)
                            .disabled(!session.composerCanEdit || session.historyEdit != nil || session.selectedConversation?.readOnly == true || !session.composer.attachmentsReady)
                            .accessibilityIdentifier("message-input")
                        if !expanded { ComposerSubmitButton(action: submit) }
                    }
                    if expanded {
                        HStack(spacing: 0) {
                            InlineIconButton(title: preferences.text("添加附件", "Add attachment"), symbol: "plus") { present(.attachments) }
                            InlineIconButton(title: preferences.text("权限模式", "Permission profile"), symbol: session.composer.configuration.permission.symbol,
                                             color: session.composer.configuration.permission == .fullAccess ? .orange : AgentTheme.ink) { present(.permissions) }
                            Button { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.16)) { showReasoning.toggle() } } label: {
                                Text(session.composer.configuration.model).font(.body)
                                    .foregroundStyle(.secondary).frame(minHeight: 44, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(preferences.text("模型和思考强度", "Model and reasoning"))
                            .accessibilityIdentifier("composer.model")
                            Spacer(minLength: 2)
                            ComposerSubmitButton(action: submit)
                        }
                    }
                }
                .padding(.horizontal, 4)
                .padding(.vertical, expanded ? 4 : 0)
                .modifier(AgentGlassSurface(cornerRadius: expanded ? 25 : 32))
                .frame(maxWidth: expanded ? .infinity : 328)
                if session.selectedConversation?.readOnly == true {
                    Text(preferences.text("只读会话", "Read-only conversation")).font(.body).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, expanded ? 12 : 20)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .onChange(of: focused) { session.inputFocused = focused }
        .onChange(of: session.composer.text) { selectedMention = 0; mentionsDismissed = false }
        .onChange(of: mentionQuery) { _, query in session.searchMentions(query ?? "") }
        .onChange(of: session.selectedConversationID) { focused = false; showReasoning = false }
        .onDisappear { session.inputFocused = false }
        .sheet(item: $activeSheet, onDismiss: { session.inputModalPresented = false }) { sheet in
            switch sheet {
            case .model: ModelSheet().presentationDetents([.medium, .large])
            case .permissions: PermissionProfileSheet().presentationDetents([.medium, .large])
            case .attachments:
                AttachmentSheet(add: addAttachments, insertLocation: insertLocation).presentationDetents([.large])
            }
        }
    }
    private func present(_ sheet: ComposerSheet) { session.inputModalPresented = true; activeSheet = sheet }
    private func addAttachments(_ items: [AttachmentItem]) async -> Bool {
        let imported = await session.importAttachmentsAndWait(items)
        if imported { focused = true }
        return imported
    }
    private func insertLocation(_ text: String) {
        if !session.composer.text.isEmpty { session.composer.text += "\n" }
        session.composer.text += text; focused = true
    }
    private func chooseMention(_ value: NativeOption) {
        session.insertMention(value)
        selectedMention = 0; focused = true
    }
    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        guard !candidates.isEmpty else { return .ignored }
        switch press.key {
        case .upArrow: selectedMention = (selectedMention + candidates.count - 1) % candidates.count
        case .downArrow: selectedMention = (selectedMention + 1) % candidates.count
        case .return, .tab: chooseMention(candidates[min(selectedMention, candidates.count - 1)])
        case .escape: mentionsDismissed = true
        default: return .ignored
        }
        return .handled
    }
    private func submit() {
        if !candidates.isEmpty { chooseMention(candidates[min(selectedMention, candidates.count - 1)]); return }
        if session.isBusy && !session.composer.hasContent, let id = session.selectedConversationID { session.stopResponse(in: id); return }
        guard session.canSubmit else { return }
        _ = session.submitCurrent()
        focused = false; showReasoning = false
    }
}
