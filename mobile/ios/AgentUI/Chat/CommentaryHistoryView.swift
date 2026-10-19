import SwiftUI

struct CommentaryHistoryView: View {
    @Environment(AppPreferences.self) private var preferences
    let entries: [ProgressEntry]
    @Binding var expanded: Bool
    var completed = true
    var duration = ""
    private var summary: String {
        duration.isEmpty ? preferences.text("执行过程", "Execution details") : preferences.text("用时\(duration)", "Worked for \(duration)")
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if completed {
                if entries.isEmpty {
                    Text(summary).font(AgentTheme.small).foregroundStyle(.secondary)
                } else {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: 6) {
                            Text(summary)
                            Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption)
                        }
                        .font(AgentTheme.small).foregroundStyle(.secondary).frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("commentary-history-toggle")
                }
            }
            if expanded || !completed {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 8) {
                        if entry.isPreviousReply == true {
                            AssistantBody(text: entry.text)
                        } else {
                            Text(entry.text).font(AgentTheme.chatBody).textSelection(.enabled)
                        }
                        if let outputs = entry.outputs, !outputs.isEmpty { OutputCards(items: outputs) }
                        if !entry.timestampLabel.isEmpty {
                            Text(entry.timestampLabel).font(.body).foregroundStyle(.secondary)
                        }
                        Divider().accessibilityIdentifier("commentary.separator")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
