import SwiftUI

struct NativeComposerView: View {
    @Bindable var store: NativeUIStore
    var onFocusChanged: (Bool) -> Void = { _ in }
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    @FocusState private var focused: Bool
    @State private var selection: TextSelection?
    @State private var adjustment: NativeComposerAdjustment?
    @State private var adjustmentReturn: NativeComposerAdjustment?
    @State private var pendingAttachmentCommand: NativeCommand?
    var body: some View {
        VStack(spacing: 12) {
            if !store.snapshot.queued.isEmpty {
                ScrollView { NativeQueuedMessagesView(store: store) }.frame(maxHeight: 132)
                    .disabled(store.awaitingNewConversation)
            }
            if !store.snapshot.attachments.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(store.snapshot.attachments) { file in
                            NativeDraftAttachmentView(attachment: file, store: store)
                        }
                    }
                }.disabled(!store.snapshot.ready || store.awaitingNewConversation)
            }
            ZStack(alignment: .bottomLeading) {
                TextField(placeholder, text: $store.composerText, selection: $selection, prompt: Text(placeholder).foregroundStyle(NativePalette.secondary), axis: .vertical)
                    .lineLimit(1...maximumLines).font(.system(size: textSize * store.snapshot.fontScale, weight: .medium))
                    .focused($focused)
                    .accessibilityIdentifier("native-composer-input")
                    .accessibilityHidden(store.sidebarOpen)
                    .disabled(!store.composerCanEdit || store.sidebarOpen)
                    .padding(.leading, expanded ? 16 : 48).padding(.trailing, expanded ? 16 : 48)
                    .padding(.top, expanded ? 17 : 14).padding(.bottom, expanded ? 58 : 14)
                    .onChange(of: selection) { updateCaret() }
                    .onChange(of: store.caretOffset) { updateSelection() }
                    .onChange(of: store.draft) { updateSelection() }
                HStack(spacing: 2) {
                    Button { store.attachmentOpen.toggle() } label: {
                        Image(systemName: "plus").font(.system(size: 23)).frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel(store.label("添加附件", "Add Attachment")).disabled(!store.composerCanEdit)
                    if expanded { NativeComposerConfigurationView(store: store, openAdjustment: openAdjustment) }
                    Spacer(minLength: 0)
                    if canInterrupt && hasDraft {
                        Button(store.label("停止", "Stop"), systemImage: "stop.circle") { store.command("turn.stop") }
                            .labelStyle(.iconOnly).font(.title2).frame(minWidth: 44, minHeight: 44)
                            .accessibilityIdentifier("native-stop")
                    }
                    Button(action: submit) {
                        Image(systemName: canInterrupt && !hasDraft ? "stop.fill" : "arrow.up")
                            .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(canSend || canInterrupt ? NativePalette.accent : Color.gray.opacity(0.35), in: .circle)
                            .frame(width: 44, height: 44)
                    }.buttonStyle(.plain).disabled(!canSend && !(canInterrupt && !hasDraft))
                        .accessibilityLabel(canInterrupt && !hasDraft ? store.label("停止", "Stop") : store.snapshot.busy ? store.label("排队发送", "Queue Message") : store.label("发送", "Send"))
                        .accessibilityIdentifier("native-send")
                }.padding(.horizontal, 4).padding(.bottom, expanded ? 4 : 2)
            }
            .frame(minHeight: expanded ? NativeVisualMetrics.composerExpandedHeight : NativeVisualMetrics.composerHeight)
            .background(NativePalette.controlFill, in: .rect(cornerRadius: expanded ? 26 : 24))
            .background(.ultraThinMaterial, in: .rect(cornerRadius: expanded ? 26 : 24))
            .overlay { RoundedRectangle(cornerRadius: expanded ? 26 : 24).stroke(.primary.opacity(0.18), lineWidth: 0.5) }
            .shadow(color: .black.opacity(0.04), radius: 10, y: 4)
        }
        .padding(.horizontal, expanded ? NativeVisualMetrics.composerExpandedInset : NativeVisualMetrics.composerInset)
        .padding(.top, 8).padding(.bottom, focused ? 12 : 6)
        .disabled(!store.snapshot.ready)
        .accessibilityHidden(store.sidebarOpen)
        .allowsHitTesting(!store.sidebarOpen)
        .onAppear { if store.visualReferenceFocused && store.composerCanEdit { focused = true } }
        .onChange(of: store.composerPresentation?.id, initial: true) { applyPresentation() }
        .onChange(of: store.awaitingNewConversation) { if store.awaitingNewConversation { focused = false } }
        .onChange(of: store.composerCanEdit) {
            if !store.composerCanEdit {
                focused = false
                if adjustment?.kind == .attachments { store.attachmentOpen = false; adjustment = nil }
            }
        }
        .sheet(item: $adjustment, onDismiss: restoreAdjustmentFocus) { session in
            switch session.kind {
            case .model: NativeModelOptionsView(store: store, adjustment: session)
            case .permission: NativePermissionOptionsView(store: store, adjustment: session)
            case .attachments:
                NativeAttachmentOptionsView(store: store) { command in
                    pendingAttachmentCommand = command
                    adjustment = nil
                }
            }
        }
        .onChange(of: store.attachmentOpen, initial: true) {
            if store.attachmentOpen && store.composerCanEdit { openAdjustment(.attachments) }
            else if adjustment?.kind == .attachments { adjustment = nil }
        }
        .onChange(of: store.snapshot.contextId) {
            if adjustment != nil || adjustmentReturn != nil {
                adjustment = nil
                adjustmentReturn = nil
                pendingAttachmentCommand = nil
                focused = false
            }
        }
        .onChange(of: focused) { onFocusChanged(focused) }
        .onDisappear { onFocusChanged(false) }
        .onChange(of: store.sidebarOpen) { if store.sidebarOpen { focused = false } }

    }
    private var canSend: Bool { store.composerCanSend }
    private var hasDraft: Bool { !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.snapshot.attachments.isEmpty }
    private var canInterrupt: Bool { store.composerCanInterrupt }
    private var maximumLines: Int { verticalSizeClass == .compact ? (dynamicTypeSize.isAccessibilitySize ? 1 : 2) : (dynamicTypeSize.isAccessibilitySize ? 3 : 6) }
    private func applyPresentation() {
        guard let presentation = store.consumeComposerPresentation(contextID: store.snapshot.contextId) else { return }
        focused = presentation == .focus
    }
    private func submit() { store.command(canInterrupt && !hasDraft ? "turn.stop" : "message.send") }
    private func openAdjustment(_ kind: NativeComposerAdjustmentKind) {
        guard store.composerCanEdit else { return }
        let session = NativeComposerAdjustment(kind: kind, contextID: store.snapshot.contextId, wasFocused: focused)
        adjustmentReturn = session
        adjustment = session
        focused = false
    }
    private func restoreAdjustmentFocus() {
        defer {
            adjustmentReturn = nil
            pendingAttachmentCommand = nil
            store.attachmentOpen = false
        }
        if let command = adjustmentReturn?.deferredAttachmentCommand(pendingAttachmentCommand, contextID: store.snapshot.contextId, editable: store.composerCanEdit, sidebarOpen: store.sidebarOpen) {
            store.perform(command)
            return
        }
        guard let session = adjustmentReturn,
              let restore = session.restoredFocus(contextID: store.snapshot.contextId, editable: store.composerCanEdit, sidebarOpen: store.sidebarOpen) else { return }
        focused = restore
    }
    private func updateCaret() {
        guard let selection, case .selection(let range) = selection.indices else { return }
        // 清空/切换草稿后，TextField 可能仍回调旧文本的选区。
        guard range.upperBound >= store.draft.startIndex, range.upperBound <= store.draft.endIndex else { return }
        store.setCaretOffset(range.upperBound.utf16Offset(in: store.draft))
    }
    private func updateSelection() {
        let position = String.Index(utf16Offset: min(store.caretOffset, store.draft.utf16.count), in: store.draft)
        selection = TextSelection(insertionPoint: position)
    }
    private var expanded: Bool { focused || adjustment != nil || (canInterrupt && hasDraft) || store.attachmentOpen || !store.snapshot.attachments.isEmpty || store.draft.contains("\n") || store.draft.count > 48 }
    private var placeholder: String {
        if let name = store.snapshot.backendName { return store.label("在 \(name) 上工作", "Work on \(name)") }
        return store.label("向 Codex 提问", "Ask Codex")
    }
}
