import SwiftUI

struct NativeComposerView: View {
    @Bindable var store: NativeUIStore
    var onFocusChanged: (Bool) -> Void = { _ in }
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    @FocusState private var focused: Bool
    @State private var selection: TextSelection?
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
                    if expanded { ScrollView(.horizontal) { configuration }.scrollIndicators(.hidden) }
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
            if store.attachmentOpen && store.composerCanEdit {
                HStack(spacing: 12) {
                    attachment(store.label("照片", "Photos"), symbol: "photo", kind: "photos")
                    attachment(store.label("文件", "Files"), symbol: "paperclip", kind: "files")
                    Button { store.command("location.insert"); store.attachmentOpen = false } label: {
                        Label(store.label("当前位置", "Current Location"), systemImage: "location")
                            .frame(maxWidth: .infinity, minHeight: 72).background(.quaternary, in: .rect(cornerRadius: 16))
                    }.buttonStyle(.plain)
                }
                Button(store.label("Skill 与插件", "Skills and Plugins"), systemImage: "at") {
                    store.command("panel.open", ["id": .string("mentions")]); store.attachmentOpen = false
                }.buttonStyle(.plain).frame(minHeight: 44)
            }
        }
        .padding(.horizontal, expanded ? NativeVisualMetrics.composerExpandedInset : NativeVisualMetrics.composerInset)
        .padding(.top, 8).padding(.bottom, focused ? 12 : 6)
        .disabled(!store.snapshot.ready)
        .accessibilityHidden(store.sidebarOpen)
        .allowsHitTesting(!store.sidebarOpen)
        .onAppear { if store.visualReferenceFocused && store.composerCanEdit { focused = true } }
        .onChange(of: store.composerPresentation?.id, initial: true) { applyPresentation() }
        .onChange(of: store.awaitingNewConversation) { if store.awaitingNewConversation { focused = false } }
        .onChange(of: store.composerCanEdit) { if !store.composerCanEdit { focused = false } }
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
    private func choose(_ name: String, value: String, context: String?) {
        guard store.composerCanEdit, context == store.snapshot.contextId else { return }
        var params: [String: NativeJSONValue] = ["value": .string(value)]
        if let context { params["contextId"] = .string(context) }
        store.command(name, params)
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
    private var expanded: Bool { focused || (canInterrupt && hasDraft) || store.attachmentOpen || !store.snapshot.attachments.isEmpty || store.draft.contains("\n") || store.draft.count > 48 }
    private var placeholder: String {
        if let name = store.snapshot.backendName { return store.label("在 \(name) 上工作", "Work on \(name)") }
        return store.label("向 Codex 提问", "Ask Codex")
    }
    private var configuration: some View {
        HStack(spacing: 2) {
            Menu {
                ForEach(store.snapshot.permissions ?? []) { option in
                    let context = store.snapshot.contextId
                    Button(option.title) { choose("permission.select", value: option.value, context: context) }
                        .accessibilityAddTraits(option.value == store.snapshot.permissionValue ? .isSelected : [])
                }
                Button(store.snapshot.permission ?? store.label("权限", "Permissions")) { store.command("panel.open", ["id": .string("permission")]) }
            } label: { configurationIcon("checkmark.shield", title: store.snapshot.permission ?? store.label("权限", "Permissions")) }
            .accessibilityLabel(store.label("权限", "Permissions"))
            .accessibilityValue(store.snapshot.permissionValue ?? store.snapshot.permission ?? "")
            .accessibilityIdentifier("native-permission-menu")
            Menu {
                ForEach(store.snapshot.models) { option in
                    let context = store.snapshot.contextId
                    Button(option.title) { choose("model.select", value: option.value, context: context) }
                        .accessibilityAddTraits(option.value == store.snapshot.modelValue ? .isSelected : [])
                }
            } label: { configurationIcon("circle.dashed", title: store.snapshot.model) }
            .accessibilityLabel(store.label("模型", "Model"))
            .accessibilityValue(store.snapshot.modelValue ?? store.snapshot.model)
            .accessibilityIdentifier("native-model-menu")
            Menu {
                ForEach(store.snapshot.speeds ?? []) { option in
                    let context = store.snapshot.contextId
                    Button(option.title) { choose("speed.select", value: option.value, context: context) }
                        .accessibilityAddTraits(option.value == store.snapshot.speedValue ? .isSelected : [])
                }
            } label: { configurationIcon("bolt.fill", title: store.snapshot.speed ?? store.label("速度", "Speed")) }
            .accessibilityLabel(store.label("速度", "Speed"))
            .accessibilityValue(store.snapshot.speedValue ?? store.snapshot.speed ?? "")
            .accessibilityIdentifier("native-speed-menu")
            Menu {
                ForEach(store.snapshot.efforts) { option in
                    let context = store.snapshot.contextId
                    Button(option.title) { choose("effort.select", value: option.value, context: context) }
                        .accessibilityAddTraits(option.value == store.snapshot.effortValue ? .isSelected : [])
                }
            } label: { configurationIcon("gauge.with.dots.needle.50percent", title: store.snapshot.effort) }
            .accessibilityLabel(store.label("推理强度", "Reasoning Effort"))
            .accessibilityValue(store.snapshot.effortValue ?? store.snapshot.effort)
            .accessibilityIdentifier("native-effort-menu")
            Menu {
                Button(store.label("Skill 与插件", "Skills and Plugins")) { store.command("panel.open", ["id": .string("mentions")]) }
                if store.snapshot.threadId == nil, hasDraft {
                    Button(store.label("保存草稿", "Save Draft")) { store.command("draft.save") }
                }
                if let usage = store.snapshot.contextUsage {
                    Text(store.label("上下文已使用 \(Int(usage.usedPercent))%", "Context used \(Int(usage.usedPercent))%"))
                }
                Button(store.label("工作区", "Workspace")) { store.command("panel.open", ["id": .string("workspace")]) }
            } label: { configurationIcon("at", title: store.label("Skill 与插件", "Skills and Plugins")) }
        }.buttonStyle(.plain).disabled(!store.composerCanEdit)
    }
    private func configurationIcon(_ symbol: String, title: String) -> some View {
        Image(systemName: symbol).font(.system(size: 20)).frame(minWidth: 44, minHeight: 44).accessibilityLabel(title)
    }
    private func attachment(_ title: String, symbol: String, kind: String) -> some View {
        Button { store.command("attachment.pick", ["kind": .string(kind)]); store.attachmentOpen = false } label: {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity, minHeight: 72).background(.quaternary, in: .rect(cornerRadius: 16))
        }.buttonStyle(.plain)
    }
}
