import SwiftUI

struct NativeAttachmentOptionsView: View {
    let store: NativeUIStore
    let choose: (NativeCommand) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HStack {
                    Text(store.label("添加附件", "Add Attachment"))
                        .modifier(NativeScaledFont(size: 19, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .headline))
                    Spacer()
                    Button(store.label("关闭", "Close"), systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(.rect)
                        .background { Circle().fill(NativePalette.settingsCard).frame(width: 34, height: 34) }
                        .buttonStyle(.plain).accessibilityIdentifier("native-attachment-close")
                }
                HStack(spacing: 10) {
                    tile(store.label("照片", "Photos"), symbol: "photo", command: NativeCommand(name: "attachment.pick", params: ["kind": .string("photos")]))
                    tile(store.label("文件", "Files"), symbol: "paperclip", command: NativeCommand(name: "attachment.pick", params: ["kind": .string("files")]))
                    tile(store.label("Skill 与插件", "Skills and Plugins"), symbol: "at", command: NativeCommand(name: "panel.open", params: ["id": .string("mentions")]))
                }
                Button { choose(NativeCommand(name: "location.insert")) } label: {
                    Label(store.label("当前位置", "Current Location"), systemImage: "location")
                        .modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale))
                        .foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44).contentShape(.rect)
                }.buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
        }.scrollIndicators(.hidden)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(NativePalette.settings)
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(290), .large]).presentationDragIndicator(.visible)
    }

    private func tile(_ title: String, symbol: String, command: NativeCommand) -> some View {
        Button { choose(command) } label: {
            VStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 30)).accessibilityHidden(true)
                Text(title).modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale))
            }
            .frame(maxWidth: .infinity, minHeight: 100).padding(.vertical, 4)
            .background(NativePalette.attachmentTile, in: .rect(cornerRadius: 20))
            .contentShape(.rect(cornerRadius: 20))
        }.buttonStyle(.plain)
    }
}
