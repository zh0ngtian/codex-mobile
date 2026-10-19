import SwiftUI

struct SidechatSharedDirectoryBanner: View {
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        Label(preferences.text("文件目录与主聊天共享，获准修改会影响同一目录。", "Files are shared with the main chat. Approved edits affect the same directory."), systemImage: "folder")
            .font(.body)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(AgentTheme.code)
            .accessibilityIdentifier("sidechat.sharedDirectory")
    }
}
