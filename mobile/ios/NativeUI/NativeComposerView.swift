import SwiftUI
import UIKit

struct NativeComposerView: View {
    @Bindable var store: NativeUIStore
    var onFocusChanged: (Bool) -> Void = { _ in }
    let availableHeight: CGFloat
    @State private var supplementaryContentHeight: CGFloat = 0
    @State private var queuedContentHeight: CGFloat = 0
    @State private var attachmentContentHeight: CGFloat = 0
    @State private var toolbarHeight: CGFloat = 44
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    @ScaledMetric(relativeTo: .body) private var toolbarSize = 16
    @FocusState private var focused: Bool
    @State private var selection: TextSelection?
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
                    NativeComposerAttachmentMenu(store: store, contextID: store.snapshot.contextId,
                        isEnabled: store.composerCanEdit && !store.sidebarOpen, isOpen: $store.attachmentOpen,
                        fontSize: toolbarSize * store.snapshot.fontScale)
                        .frame(width: 44, height: 44)
                    if expanded { NativeComposerConfigurationView(store: store) }
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
                }.font(.system(size: toolbarSize * store.snapshot.fontScale, weight: .semibold))
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { toolbarHeight = $0 }
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
            if !store.composerCanEdit { focused = false; store.attachmentOpen = false }
        }
        .onChange(of: focused) { onFocusChanged(focused) }
        .onDisappear { store.attachmentOpen = false; onFocusChanged(false) }
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
            toolbarHeight: Double(max(toolbarHeight, ceil(UIFont.systemFont(ofSize: toolbarSize * store.snapshot.fontScale, weight: .semibold).lineHeight) + 1)),
            expanded: expanded, focused: focused, compact: verticalSizeClass == .compact,
            hasSupplementaryContent: hasSupplementaryContent)
    }
    private var supplementaryHeight: CGFloat { min(supplementaryContentHeight, layoutBudget.supplementaryMaximumHeight) }
    private var inputAvailableHeight: CGFloat {
        availableHeight - supplementaryHeight - layoutBudget.supplementarySpacing - layoutBudget.outerHeight
    }
    private var expanded: Bool { focused || (canInterrupt && hasDraft) || store.attachmentOpen || !store.snapshot.attachments.isEmpty || store.draft.contains("\n") || store.draft.count > 48 }
    private var placeholder: String {
        if let name = store.snapshot.backendName { return store.label("在 \(name) 上工作", "Work on \(name)") }
        return store.label("向 Codex 提问", "Ask Codex")
    }
}
