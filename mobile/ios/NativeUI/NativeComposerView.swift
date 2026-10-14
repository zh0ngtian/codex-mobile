import SwiftUI

struct NativeComposerView: View {
    @Bindable var store: NativeUIStore
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    @State private var selection: TextSelection?
    var body: some View {
        VStack(spacing: 12) {
            if !store.snapshot.queued.isEmpty {
                ScrollView { NativeQueuedMessagesView(store: store) }.frame(maxHeight: 132)
            }
            if !store.snapshot.attachments.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(store.snapshot.attachments) { file in
                            HStack {
                                Label(file.name, systemImage: "doc")
                                Button(store.label("移除", "Remove"), systemImage: "xmark") { store.command("attachment.remove", ["id": .string(file.id)]) }.labelStyle(.iconOnly)
                            }.font(.caption).padding(8).background(.quaternary, in: .capsule)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                TextField(store.label("发送消息或描述任务", "Send a message or describe a task"), text: $store.composerText, selection: $selection, axis: .vertical)
                    .lineLimit(1...6).font(.system(size: textSize * store.snapshot.fontScale))
                    .accessibilityIdentifier("native-composer-input")
                    .disabled(store.snapshot.readOnly)
                    .onChange(of: selection) { updateCaret() }
                    .onChange(of: store.caretOffset) { updateSelection() }
                    .onChange(of: store.draft) { updateSelection() }
                HStack(spacing: 6) {
                    ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                    Menu {
                        ForEach(store.snapshot.models) { option in
                            let context = store.snapshot.contextId
                            Button(option.title) { choose("model.select", value: option.value, context: context) }
                        }
                    } label: { chip(store.snapshot.model, symbol: "cpu", selected: false) }
                    Menu {
                        ForEach(store.snapshot.efforts) { option in
                            let context = store.snapshot.contextId
                            Button(option.title) { choose("effort.select", value: option.value, context: context) }
                        }
                    } label: { chip(store.snapshot.effort, symbol: "sparkle", selected: true) }
                    Button { store.command("panel.open", ["id": .string("mentions")]) } label: { chip(store.label("Skill 与插件", "Skills and Plugins"), symbol: "at", selected: false) }
                    if let permission = store.snapshot.permission {
                        Button { store.command("panel.open", ["id": .string("permission")]) } label: { chip(permission, symbol: "lock", selected: false) }
                    }
                    if store.snapshot.threadId == nil, hasDraft {
                        Button { store.command("draft.save") } label: { chip(store.label("保存草稿", "Save Draft"), symbol: "square.and.arrow.down", selected: false) }
                    }
                    }
                    }.scrollIndicators(.hidden)
                    Spacer(minLength: 0)
                    Button { store.attachmentOpen.toggle() } label: {
                        Image(systemName: store.attachmentOpen ? "xmark.circle" : "plus.circle").font(.system(size: 22)).frame(minWidth: 44, minHeight: 44)
                    }.buttonStyle(.plain).accessibilityLabel(store.label("添加附件", "Add Attachment")).disabled(store.snapshot.readOnly)
                    if canInterrupt && hasDraft {
                        Button(store.label("停止", "Stop"), systemImage: "stop.circle") { store.command("turn.stop") }
                            .labelStyle(.iconOnly).font(.title2).frame(minWidth: 44, minHeight: 44)
                            .accessibilityIdentifier("native-stop")
                    }
                    Button(action: submit) {
                        Image(systemName: canInterrupt && !hasDraft ? "stop.fill" : "arrow.up")
                            .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(canSend || canInterrupt ? NativePalette.accent : Color.gray.opacity(0.35), in: .circle)
                            .frame(minWidth: 44, minHeight: 44)
                    }.buttonStyle(.plain).disabled(!canSend && !(canInterrupt && !hasDraft))
                        .accessibilityLabel(canInterrupt && !hasDraft ? store.label("停止", "Stop") : store.snapshot.busy ? store.label("排队发送", "Queue Message") : store.label("发送", "Send"))
                        .accessibilityIdentifier("native-send")
                }
            }.padding(.horizontal, 12).padding(.top, 14).padding(.bottom, 6)
                .frame(minHeight: 104).background(NativePalette.canvas, in: .rect(cornerRadius: 26))
                .overlay { RoundedRectangle(cornerRadius: 26).stroke(.primary.opacity(0.08), lineWidth: 0.5) }
                .shadow(color: .black.opacity(0.06), radius: 6, y: 2)
            if store.attachmentOpen {
                HStack(spacing: 12) {
                    attachment(store.label("照片", "Photos"), symbol: "photo", kind: "photos")
                    attachment(store.label("文件", "Files"), symbol: "paperclip", kind: "files")
                    Button { store.command("location.insert"); store.attachmentOpen = false } label: {
                        Label(store.label("当前位置", "Current Location"), systemImage: "location")
                            .frame(maxWidth: .infinity, minHeight: 72).background(.quaternary, in: .rect(cornerRadius: 16))
                    }.buttonStyle(.plain)
                }
            }
        }.padding(.horizontal, 12).padding(.top, 6).background(NativePalette.canvas)
    }
    private var canSend: Bool {
        !store.snapshot.readOnly && (store.isReference ? !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : store.snapshot.canSend)
    }
    private var hasDraft: Bool { !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.snapshot.attachments.isEmpty }
    private var canInterrupt: Bool { store.snapshot.canInterrupt ?? store.snapshot.busy }
    private func submit() { store.command(canInterrupt && !hasDraft ? "turn.stop" : "message.send") }
    private func choose(_ name: String, value: String, context: String?) {
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
    private func chip(_ title: String, symbol: String, selected: Bool) -> some View {
        Label(title, systemImage: symbol).font(.caption.weight(.medium)).fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 9).frame(minHeight: 32)
            .foregroundStyle(selected ? NativePalette.accent : Color.primary)
            .background(selected ? NativePalette.bubble : NativePalette.canvas, in: .capsule)
            .overlay { Capsule().stroke(.primary.opacity(0.07), lineWidth: 0.5) }
    }
    private func attachment(_ title: String, symbol: String, kind: String) -> some View {
        Button { store.command("attachment.pick", ["kind": .string(kind)]); store.attachmentOpen = false } label: {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity, minHeight: 72).background(.quaternary, in: .rect(cornerRadius: 16))
        }.buttonStyle(.plain)
    }
}
