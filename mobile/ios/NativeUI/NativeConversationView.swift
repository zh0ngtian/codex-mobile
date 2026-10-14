import SwiftUI

struct NativeConversationView: View {
    @Bindable var store: NativeUIStore
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                NativeIconButton(title: store.label("打开侧栏", "Open Sidebar"), symbol: "line.3.horizontal", identifier: "native-sidebar-open") { store.sidebarOpen.toggle() }
                Text(store.snapshot.messages.isEmpty ? "" : store.snapshot.title)
                    .font(.headline).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                NativeIconButton(title: store.label("新对话", "New Conversation"), symbol: "square.and.pencil", identifier: "native-new-thread") { store.command("thread.new") }
            }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
            if let error = store.snapshot.error {
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
                Text(store.label("你好，让我们开始吧", "Hello, let’s get started")).font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 26) {
                        ForEach(store.snapshot.messages) { message in NativeMessageView(message: message, store: store) }
                    }.padding(.top, 12).padding(.bottom, 24)
                }.defaultScrollAnchor(.bottom).scrollDismissesKeyboard(.interactively)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { NativeComposerView(store: store) }
    }
}
