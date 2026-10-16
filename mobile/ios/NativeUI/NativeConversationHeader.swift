import SwiftUI

struct NativeConversationHeader: View {
    let store: NativeUIStore
    let noDevice: Bool
    @ScaledMetric(relativeTo: .headline) private var titleSize = 15
    var body: some View {
        Group {
            if noDevice {
                HStack {
                    Text("Codex Mobile").font(.headline)
                    Spacer()
                    NativeIconButton(title: store.label("设置", "Settings"), symbol: "gearshape", identifier: "native-settings-open") { store.settingsOpen = true }
                }.padding(.horizontal, 16).padding(.bottom, 10)
            } else {
                HStack(spacing: 12) {
                    NativeIconButton(title: store.label("打开侧栏", "Open Sidebar"), symbol: "chevron.left", identifier: "native-sidebar-open") { store.sidebarIsOpen.toggle() }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(store.snapshot.messages.isEmpty ? store.label("新对话", "New Conversation") : store.snapshot.title)
                            .font(.system(size: titleSize * store.snapshot.fontScale, weight: .bold)).lineLimit(1)
                        NativeConversationSubtitle(project: store.snapshot.projectName, backend: store.snapshot.backendName, scale: store.snapshot.fontScale)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 0) {
                        NativeContextUsageButton(store: store)
                        Button { store.command("thread.new") } label: {
                            Image(systemName: "square.and.pencil").resizable().scaledToFit()
                                .font(.system(size: NativeVisualMetrics.headerIconSize, weight: .regular))
                                .frame(width: NativeVisualMetrics.headerIconSize, height: NativeVisualMetrics.headerIconSize)
                                .frame(width: NativeVisualMetrics.controlHeight, height: NativeVisualMetrics.controlHeight).contentShape(.rect)
                        }.accessibilityLabel(store.label("新对话", "New Conversation")).accessibilityIdentifier("native-new-thread")
                            .disabled(!store.snapshot.ready || store.snapshot.pending == true || store.awaitingNewConversation)
                        Menu {
                            ForEach(store.snapshot.conversationActions ?? []) { item in NativePanelItemView(item: item, store: store, scope: .message("conversation:\(store.threadKey)")) }
                            Button(store.label("工作区", "Workspace"), systemImage: "folder") { store.command("panel.open", ["id": .string("workspace")]) }
                        } label: {
                            Image(systemName: "ellipsis").resizable().scaledToFit()
                                .font(.system(size: NativeVisualMetrics.headerIconSize, weight: .regular))
                                .frame(width: NativeVisualMetrics.headerIconSize, height: NativeVisualMetrics.headerIconSize)
                                .frame(width: NativeVisualMetrics.controlHeight, height: NativeVisualMetrics.controlHeight).contentShape(.rect)
                        }.accessibilityLabel(store.label("会话操作", "Conversation Actions"))
                    }.buttonStyle(.plain).padding(.horizontal, 4)
                        .background(NativePalette.controlFill, in: .capsule)
                        .background(.ultraThinMaterial, in: .capsule)
                        .overlay { Capsule().stroke(.primary.opacity(0.12), lineWidth: 0.5) }
                }.padding(.horizontal, NativeVisualMetrics.pageInset).padding(.bottom, 0)
            }
        }
        .background {
            NativeBackdropBlur().ignoresSafeArea(.container, edges: .top)
        }
    }
}
