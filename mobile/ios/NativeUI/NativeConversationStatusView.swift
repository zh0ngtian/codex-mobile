import SwiftUI

struct NativeConversationStatusView: View {
    let store: NativeUIStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if store.snapshot.approvalCount > 0 {
                Button { store.command("approval.reopen") } label: {
                    Label(store.label("有 \(store.snapshot.approvalCount) 项待处理请求", "\(store.snapshot.approvalCount) pending requests"), systemImage: "exclamationmark.bubble")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }.buttonStyle(.plain).padding(.horizontal, 12).background(NativePalette.bubble, in: .rect(cornerRadius: 12))
            }
            if let status {
                Button { store.command("panel.open", ["id": .string("workspace")]) } label: {
                    HStack(spacing: 8) {
                        if store.snapshot.busy || store.snapshot.pending == true || store.snapshot.connection == "connecting" { ProgressView().controlSize(.small) }
                        Text(status).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
                    }.frame(minHeight: 44)
                }.buttonStyle(.plain)
            }
        }.modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption)).padding(.horizontal, 24)
    }
    private var status: String? {
        if let badge = store.snapshot.badge { return badge }
        if store.snapshot.readOnly { return store.label("当前会话只读", "Read-only conversation") }
        if store.snapshot.pending == true { return store.label("等待操作确认", "Waiting for confirmation") }
        if store.snapshot.busy { return store.label("正在执行", "Working") }
        if store.snapshot.loading == "loading" { return store.label("正在加载会话…", "Loading conversation…") }
        if store.snapshot.backendId != nil, store.snapshot.connection != "connected" {
            return store.snapshot.connection == "connecting" ? store.label("正在连接设备…", "Connecting to device…") : store.label("设备连接已断开", "Device disconnected")
        }
        return nil
    }
}
