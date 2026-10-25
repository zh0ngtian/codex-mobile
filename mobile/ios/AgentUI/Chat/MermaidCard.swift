import SwiftUI

/// 消费业务桥按实际源码生成的 SVG；源码始终可查看和复制。
struct MermaidCard: View {
    @Environment(AppPreferences.self) private var preferences
    let source: String
    let store: NativeUIStore?
    @State private var showSource = false
    @State private var copied = false

    private var svg: String? {
        store?.snapshot.richContent?.first { $0.kind == "html" && $0.text == source }?.value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Mermaid").font(AgentTheme.small)
                Spacer()
                if svg != nil {
                    Button(preferences.text(showSource ? "预览" : "查看源码", showSource ? "Preview" : "View source")) {
                        showSource.toggle()
                    }
                    .accessibilityIdentifier("mermaid.toggle-source")
                }
                Button(copied ? preferences.text("已复制", "Copied") : preferences.text("复制源码", "Copy source"),
                       systemImage: copied ? "checkmark" : "square.on.square") {
                    Clipboard.copy(source)
                    copied = true
                }
                .labelStyle(.iconOnly).frame(width: 44, height: 44)
                .accessibilityIdentifier("mermaid.copy")
            }
            if let svg, !showSource {
                NativeHTMLContentView(html: svg, title: "Mermaid")
            } else {
                CodeCard(code: source, language: "mermaid", showsHeader: false)
                if svg == nil, let store {
                    Button(preferences.text("预览图表", "Preview diagram"), systemImage: "point.3.connected.trianglepath.dotted") {
                        store.command("diagram.render", ["source": .string(source)])
                    }
                    .frame(minHeight: 44).accessibilityIdentifier("mermaid.render")
                }
            }
        }
        .font(AgentTheme.small)
        .onChange(of: source) { _, _ in showSource = false; copied = false }
    }
}
