import SwiftUI

struct NativeComposerView: View {
    @Bindable var store: NativeUIStore
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    var body: some View {
        VStack(spacing: 12) {
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
                TextField(store.label("发送消息或描述任务", "Send a message or describe a task"), text: $store.draft, axis: .vertical)
                    .lineLimit(1...6).font(.system(size: textSize * store.snapshot.fontScale))
                    .accessibilityIdentifier("native-composer-input")
                    .disabled(store.snapshot.readOnly)
                    .onChange(of: store.draft) { store.updateDraft() }
                HStack(spacing: 6) {
                    ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                    Menu {
                        ForEach(store.snapshot.models) { option in Button(option.title) { store.command("model.select", ["value": .string(option.value)]) } }
                    } label: { chip(store.snapshot.model, symbol: "cpu", selected: false) }
                    Menu {
                        ForEach(store.snapshot.efforts) { option in Button(option.title) { store.command("effort.select", ["value": .string(option.value)]) } }
                    } label: { chip(store.snapshot.effort, symbol: "sparkle", selected: true) }
                    }
                    }.scrollIndicators(.hidden)
                    Spacer(minLength: 0)
                    Button { store.attachmentOpen.toggle() } label: {
                        Image(systemName: store.attachmentOpen ? "xmark.circle" : "plus.circle").font(.system(size: 22)).frame(minWidth: 44, minHeight: 44)
                    }.buttonStyle(.plain).accessibilityLabel(store.label("添加附件", "Add Attachment"))
                    Button { store.command(store.snapshot.busy ? "turn.stop" : "message.send") } label: {
                        Image(systemName: store.snapshot.busy ? "stop.fill" : "arrow.up")
                            .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(canSend || store.snapshot.busy ? NativePalette.accent : Color.gray.opacity(0.35), in: .circle)
                            .frame(minWidth: 44, minHeight: 44)
                    }.buttonStyle(.plain).disabled(!canSend && !store.snapshot.busy)
                        .accessibilityLabel(store.snapshot.busy ? store.label("停止", "Stop") : store.label("发送", "Send")).accessibilityIdentifier("native-send")
                }
            }.padding(.horizontal, 12).padding(.top, 14).padding(.bottom, 6)
                .frame(minHeight: 104).background(NativePalette.canvas, in: .rect(cornerRadius: 26))
                .overlay { RoundedRectangle(cornerRadius: 26).stroke(.primary.opacity(0.08), lineWidth: 0.5) }
                .shadow(color: .black.opacity(0.06), radius: 6, y: 2)
            if store.attachmentOpen {
                HStack(spacing: 12) {
                    attachment(store.label("照片", "Photos"), symbol: "photo", kind: "photos")
                    attachment(store.label("文件", "Files"), symbol: "paperclip", kind: "files")
                }
            }
            if !store.snapshot.queued.isEmpty {
                Text("\(store.label("排队中：", "Queued: "))\(store.snapshot.queued.count)").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.horizontal, 12).padding(.top, 6).background(NativePalette.canvas)
    }
    private var canSend: Bool {
        !store.snapshot.readOnly && (store.isReference ? !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : store.snapshot.canSend)
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
