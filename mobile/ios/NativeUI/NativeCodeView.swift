import SwiftUI
import UIKit

struct NativeCodeView: View {
    let text: String
    var language: String = ""
    var scale: Double = 1
    @Environment(\.locale) private var locale
    @AppStorage("codeWrapsLines") private var wrapsLines = true
    private var isChinese: Bool { locale.identifier.lowercased().hasPrefix("zh") }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language).modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption)).foregroundStyle(.secondary)
                Spacer()
                Button(isChinese ? "复制" : "Copy", systemImage: "document.on.document") { UIPasteboard.general.string = text }
                    .modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption)).frame(minHeight: 44).accessibilityLabel(isChinese ? "复制代码" : "Copy Code")
                    .accessibilityIdentifier("code.copy")
            }.padding(.horizontal, 12)
            Divider()
            Group {
                if wrapsLines {
                    selectableCode.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView(.horizontal) {
                        selectableCode.fixedSize(horizontal: true, vertical: true)
                    }
                }
            }.padding(12)
        }.background(NativePalette.code, in: .rect(cornerRadius: 12))
    }
    private var selectableCode: some View {
        NativeSelectableText(text: NativeSelectableMarkdown.code(text, language: language), identifier: "code.selectable")
    }
}
