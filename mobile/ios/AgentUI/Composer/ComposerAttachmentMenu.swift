import SwiftUI

struct ComposerAttachmentMenu: View {
    @Environment(AppPreferences.self) private var preferences
    let enabled: Bool
    let choose: (NativeComposerAttachmentAction) -> Void

    var body: some View {
        Menu {
            Button(preferences.text("选择图片", "Choose images"), systemImage: "photo.on.rectangle") { choose(.photos) }
                .accessibilityIdentifier("composer.attachments.photos")
            Button(preferences.text("选择文件", "Choose files"), systemImage: "folder") { choose(.files) }
                .accessibilityIdentifier("composer.attachments.files")
            Button(preferences.text("当前位置", "Current location"), systemImage: "location") { choose(.location) }
                .accessibilityIdentifier("composer.attachments.location")
        } label: {
            Image(systemName: "plus").font(.subheadline).imageScale(.large)
                .foregroundStyle(AgentTheme.ink)
                .modifier(ComposerControlSurface(circular: true))
        }
        .menuIndicator(.hidden).menuOrder(.fixed).buttonStyle(.plain).tint(AgentTheme.ink)
        .disabled(!enabled)
        .accessibilityLabel(preferences.text("添加附件", "Add attachment"))
        .accessibilityIdentifier("composer.attachments")
    }
}
