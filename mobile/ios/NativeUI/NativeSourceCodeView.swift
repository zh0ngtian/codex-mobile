import SwiftUI
import UIKit

struct NativeSourceCodeView: View {
    let text: String
    let title: String
    var targetLine: Int? = nil
    let scale: Double
    @ScaledMetric(relativeTo: .callout) private var fontSize = 12
    @Environment(\.locale) private var locale
    private var lines: [String] { text.components(separatedBy: "\n") }
    var body: some View {
        let sourceLines = lines
        let gutterWidth = CGFloat(max(3, String(sourceLines.count).count)) * fontSize * scale * 0.7
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).lineLimit(1)
                Spacer(minLength: 8)
                Button(locale.identifier.hasPrefix("zh") ? "复制全文" : "Copy All", systemImage: "document.on.document") { UIPasteboard.general.string = text }
                    .frame(minHeight: 44)
            }.modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption)).padding(.horizontal, 12)
            Divider()
            ScrollViewReader { proxy in
                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(sourceLines.enumerated()), id: \.offset) { index, line in
                            HStack(alignment: .top, spacing: 12) {
                                Text(String(index + 1)).foregroundStyle(.secondary)
                                    .frame(width: gutterWidth, alignment: .trailing)
                                    .accessibilityHidden(true)
                                Text(NativeCodeHighlight.text(line.isEmpty ? " " : line, language: (title as NSString).pathExtension))
                                    .fixedSize(horizontal: true, vertical: false)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .font(.system(size: fontSize * scale, design: .monospaced))
                            .padding(.horizontal, 12).padding(.vertical, 3)
                            .background(targetLine == index + 1 ? NativePalette.bubble : .clear)
                            .id(index + 1)
                        }
                    }.padding(.vertical, 8)
                }
                .frame(minHeight: 160, maxHeight: 420).textSelection(.enabled)
                .task { focus(proxy) }
                .onChange(of: targetLine) { focus(proxy) }
                .onChange(of: text) { focus(proxy) }
            }
        }.background(NativePalette.code, in: .rect(cornerRadius: 12))
    }
    private func focus(_ proxy: ScrollViewProxy) {
        if let targetLine, (1...max(1, lines.count)).contains(targetLine) { proxy.scrollTo(targetLine, anchor: .center) }
    }
}
