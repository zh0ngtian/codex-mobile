import SwiftUI

struct CommentaryHistoryView: View {
    @Environment(AppPreferences.self) private var preferences
    let entries: [ProgressEntry]
    @Binding var expanded: Bool
    var completed = true
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if completed {
                Button { expanded.toggle() } label: {
                    HStack(spacing: 6) {
                        Text(preferences.text("之前的 \(entries.count) 条消息", "\(entries.count) earlier messages"))
                        Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 10, weight: .medium))
                    }
                    .font(AgentTheme.small).foregroundStyle(AgentTheme.ink.opacity(0.4)).frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("commentary-history-toggle")
            }
            if expanded || !completed {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(entry.text).font(AgentTheme.chatBody).textSelection(.enabled)
                        if let outputs = entry.outputs, !outputs.isEmpty { OutputCards(items: outputs) }
                        if !entry.timestampLabel.isEmpty {
                            Text(entry.timestampLabel).font(.caption).foregroundStyle(.secondary)
                        }
                        if entry.id != entries.last?.id { Divider().opacity(0.3) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
