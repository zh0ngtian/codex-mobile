import SwiftUI

struct NativeMarkdownImageView: View {
    let source: String
    let title: String
    let store: NativeUIStore?
    var body: some View {
        Group {
            if let resource = store?.snapshot.richContent?.first(where: { $0.kind == "image" && $0.text == source }) {
                NativeImageView(source: resource.value ?? source, title: title, previewSource: resource.previewURL)
            } else if NativeImageData.remoteURL(source) != nil || source.hasPrefix("data:") {
                NativeImageView(source: source, title: title)
            } else if let store {
                Button(title.isEmpty ? store.label("查看图片", "View Image") : title, systemImage: "photo") {
                    store.command("file.open", ["href": .string(source)])
                }
            }
        }
    }
}
