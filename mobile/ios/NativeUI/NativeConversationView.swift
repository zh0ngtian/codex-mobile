import SwiftUI

struct NativeConversationView: View {
    @Bindable var store: NativeUIStore
    @ScaledMetric(relativeTo: .headline) private var titleSize = 14
    @ScaledMetric(relativeTo: .title3) private var greetingSize = 18
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                NativeIconButton(title: store.label("打开侧栏", "Open Sidebar"), symbol: "line.3.horizontal", identifier: "native-sidebar-open") { store.sidebarIsOpen.toggle() }
                Text(store.snapshot.messages.isEmpty ? "" : store.snapshot.title)
                    .font(.system(size: titleSize * store.snapshot.fontScale, weight: .semibold)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                if let actions = store.snapshot.conversationActions, !actions.isEmpty {
                    Menu(store.label("会话操作", "Conversation Actions"), systemImage: "ellipsis") {
                        ForEach(actions) { item in NativePanelItemView(item: item, store: store, scope: .message("conversation:\(store.threadKey)")) }
                    }.labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                }
                NativeIconButton(title: store.label("新对话", "New Conversation"), symbol: "square.and.pencil", identifier: "native-new-thread") { store.command("thread.new") }
            }.padding(.horizontal, 16).padding(.bottom, 10)
            if let error = store.snapshot.error ?? store.commandError {
                VStack(spacing: 12) {
                    Text(error).font(.callout).textSelection(.enabled)
                    Button(store.label("使用旧界面恢复", "Recover Using Web Interface")) { store.showLegacyForRecovery = true }
                }.padding().frame(maxWidth: .infinity).background(.red.opacity(0.08))
            }
            if !store.snapshot.ready {
                VStack(spacing: 16) {
                    ProgressView(store.label("正在加载", "Loading"))
                    Button(store.label("使用旧界面恢复", "Recover Using Web Interface")) { store.showLegacyForRecovery = true }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.snapshot.messages.isEmpty {
                Text(store.label("你好，让我们开始吧", "Hello, let’s get started")).font(.system(size: greetingSize * store.snapshot.fontScale, weight: .semibold))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                NativeTimelineView(store: store, timeline: store.timeline(for: store.threadKey)).id(store.threadKey)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 4) {
                if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                if let mentions = store.snapshot.mentions, !mentions.isEmpty {
                    NativeMentionSuggestions(items: mentions, store: store, context: store.snapshot.contextId).padding(.horizontal, 12)
                }
                NativeComposerView(store: store).id(store.contextKey)
            }
        }
    }
}
