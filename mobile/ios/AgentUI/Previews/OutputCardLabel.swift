import SwiftUI

struct OutputCardLabel: View {
    @Environment(AppPreferences.self) private var preferences
    let item: OutputItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.previewSymbol)
                .font(.title3).foregroundStyle(.secondary)
                .frame(width: 38, height: 42)
                .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name).font(.body).lineLimit(1)
                Text(item.kind == .web
                     ? preferences.text("在浏览器中打开", "Open in browser")
                     : preferences.text("查看产出", "View output"))
                    .font(.body).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Image(systemName: item.kind == .web ? "arrow.up.right" : "chevron.right")
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
        .padding(10)
        .foregroundStyle(AgentTheme.ink)
        .contentShape(.rect(cornerRadius: 16))
    }
}
