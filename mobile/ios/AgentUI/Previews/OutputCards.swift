import SwiftUI

struct OutputCards: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.openURL) private var openURL
    let items: [OutputItem]

    var body: some View {
        VStack(spacing: 8) {
            ForEach(items) { item in
                if item.kind == .image {
                    OutputImageCard(item: item)
                } else if item.kind == .video {
                    OutputVideoCard(item: item)
                } else {
                    Button { open(item) } label: {
                        OutputCardLabel(item: item)
                            .background(AgentTheme.card, in: .rect(cornerRadius: 16))
                            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(AgentTheme.line) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(item.kind == .web
                                       ? preferences.text("打开普通网页链接", "Open a web link")
                                       : preferences.text("打开文件预览", "Open file preview"))
                }
            }
        }
    }

    private func open(_ item: OutputItem) {
        if item.kind == .web, let url = URL(string: item.content),
           ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            openURL(url)
        } else {
            session.previewItem = item
        }
    }
}
