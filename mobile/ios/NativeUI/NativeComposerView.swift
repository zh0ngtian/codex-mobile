import SwiftUI
import UIKit

struct NativeComposerView: View {
    @Bindable var store: NativeUIStore
    var onFocusChanged: (Bool) -> Void = { _ in }
    let availableHeight: CGFloat
    @State private var supplementaryContentHeight: CGFloat = 0
    @State private var queuedContentHeight: CGFloat = 0
    @State private var attachmentContentHeight: CGFloat = 0
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    @FocusState private var focused: Bool
    @State private var selection: TextSelection?
    @State private var adjustment: NativeComposerAdjustment?
    @State private var adjustmentReturn: NativeComposerAdjustment?
    @State private var pendingAttachmentCommand: NativeCommand?
    var body: some View {
        VStack(spacing: layoutBudget.supplementarySpacing) {
            if hasSupplementaryContent {
                ScrollView {
                    VStack(spacing: layoutBudget.supplementarySpacing) {
                        if !store.snapshot.queued.isEmpty {
                            ScrollView {
                                NativeQueuedMessagesView(store: store)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { queuedContentHeight = $0 }
                            }
                            .frame(height: min(132, queuedContentHeight))
                            .disabled(store.awaitingNewConversation)
                        }
                        if !store.snapshot.attachments.isEmpty {
                            ScrollView(.horizontal) {
                                HStack {
                                    ForEach(store.snapshot.attachments) { file in
                                        NativeDraftAttachmentView(attachment: file, store: store)
                                    }
                                }
                                .fixedSize(horizontal: false, vertical: true)
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { attachmentContentHeight = $0 }
                            }
                            .frame(height: attachmentContentHeight)
                            .disabled(!store.snapshot.ready || store.awaitingNewConversation)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { supplementaryContentHeight = $0 }
                }
                .frame(height: supplementaryHeight)
                .accessibilityIdentifier("native-composer-supplementary")
            }
            ZStack(alignment: .bottomLeading) {
                TextField(placeholder, text: $store.composerText, selection: $selection, prompt: Text(placeholder).foregroundStyle(NativePalette.secondary), axis: .vertical)
                    .lineLimit(composerLineLimits).font(.system(size: textSize * store.snapshot.fontScale, weight: .medium))
                    .focused($focused)
                    .accessibilityIdentifier("native-composer-input")
                    .accessibilityHidden(store.sidebarOpen)
                    .disabled(!store.composerCanEdit || store.sidebarOpen)
                    .padding(.leading, expanded ? 16 : 48).padding(.trailing, expanded ? 16 : 48)
                    .padding(.top, layoutBudget.editorTopInset).padding(.bottom, layoutBudget.editorBottomInset)
                    .onChange(of: selection) { updateCaret() }
                    .onChange(of: store.selectionRevision, initial: true) { updateSelection() }
                HStack(spacing: 2) {
                    Button { store.attachmentOpen.toggle() } label: {
                        Image(systemName: "plus").frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel(store.label("添加附件", "Add Attachment")).disabled(!store.composerCanEdit)
                    if expanded { NativeComposerConfigurationView(store: store, openAdjustment: openAdjustment) }
                    Spacer(minLength: 0)
                    if canInterrupt && hasDraft {
                        Button(store.label("停止", "Stop"), systemImage: "stop.circle") { store.command("turn.stop") }
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                            .accessibilityIdentifier("native-stop")
                    }
                    Button(action: submit) {
                        Image(systemName: canInterrupt && !hasDraft ? "stop.fill" : "arrow.up")
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(canSend || canInterrupt ? NativePalette.accent : Color.gray.opacity(0.35), in: .circle)
                            .frame(width: 44, height: 44)
                    }.buttonStyle(.plain).disabled(!canSend && !(canInterrupt && !hasDraft))
                        .accessibilityLabel(canInterrupt && !hasDraft ? store.label("停止", "Stop") : store.snapshot.busy ? store.label("排队发送", "Queue Message") : store.label("发送", "Send"))
                        .accessibilityIdentifier("native-send")
                }.modifier(NativeScaledFont(size: 16, scale: store.snapshot.fontScale, weight: .semibold))
                .padding(.horizontal, 4).padding(.bottom, expanded ? 4 : 2)
            }
            .frame(minHeight: layoutBudget.editorMinimumHeight)
            .background(NativePalette.controlFill, in: .rect(cornerRadius: expanded ? 26 : 24))
            .background(.ultraThinMaterial, in: .rect(cornerRadius: expanded ? 26 : 24))
            .overlay { RoundedRectangle(cornerRadius: expanded ? 26 : 24).stroke(.primary.opacity(0.18), lineWidth: 0.5) }
            .shadow(color: .black.opacity(0.04), radius: 10, y: 4)
        }
        .padding(.horizontal, expanded ? NativeVisualMetrics.composerExpandedInset : NativeVisualMetrics.composerInset)
        .padding(.top, layoutBudget.outerTopInset).padding(.bottom, layoutBudget.outerBottomInset)
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
    private var composerLineLimits: ClosedRange<Int> {
        NativeComposerLineLimits.resolve(availableHeight: Double(inputAvailableHeight),
            lineHeight: Double(inputLineHeight), compact: verticalSizeClass == .compact,
            accessibility: dynamicTypeSize.isAccessibilitySize, chromeHeight: layoutBudget.editorChromeHeight)
    }
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
    private var hasSupplementaryContent: Bool { !store.snapshot.attachments.isEmpty || !store.snapshot.queued.isEmpty }
    private var inputLineHeight: CGFloat { UIFont.systemFont(ofSize: textSize * store.snapshot.fontScale, weight: .medium).lineHeight }
    private var layoutBudget: NativeComposerLayoutBudget {
        NativeComposerLayoutBudget.resolve(availableHeight: Double(availableHeight), lineHeight: Double(inputLineHeight),
            toolbarLineHeight: Double(UIFont.systemFont(ofSize: textSize * (16.0 / 14.0) * store.snapshot.fontScale, weight: .semibold).lineHeight),
            expanded: expanded, focused: focused, compact: verticalSizeClass == .compact,
            hasSupplementaryContent: hasSupplementaryContent)
    }
    private var supplementaryHeight: CGFloat { min(supplementaryContentHeight, layoutBudget.supplementaryMaximumHeight) }
    private var inputAvailableHeight: CGFloat {
        availableHeight - supplementaryHeight - layoutBudget.supplementarySpacing - layoutBudget.outerHeight
    }
    private var expanded: Bool { focused || adjustment != nil || (canInterrupt && hasDraft) || store.attachmentOpen || !store.snapshot.attachments.isEmpty || store.draft.contains("\n") || store.draft.count > 48 }
    private var placeholder: String {
        if let name = store.snapshot.backendName { return store.label("在 \(name) 上工作", "Work on \(name)") }
        return store.label("向 Codex 提问", "Ask Codex")
    }
}
