import SwiftUI
import UIKit

struct NativeCodeView: View {
    let text: String
    var language: String = ""
    var scale: Double = 1
    @Environment(\.locale) private var locale
    private var isChinese: Bool { locale.identifier.lowercased().hasPrefix("zh") }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language).modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption)).foregroundStyle(.secondary)
                Spacer()
                Button(isChinese ? "复制" : "Copy", systemImage: "document.on.document") { UIPasteboard.general.string = text }
                    .modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption)).frame(minHeight: 44).accessibilityLabel(isChinese ? "复制代码" : "Copy Code")
            }.padding(.horizontal, 12)
            Divider()
            ScrollView(.horizontal) {
                Text(NativeCodeHighlight.text(text, language: language)).font(.body.monospaced()).textSelection(.enabled).padding(12)
            }
        }.background(NativePalette.code, in: .rect(cornerRadius: 12))
    }
}
