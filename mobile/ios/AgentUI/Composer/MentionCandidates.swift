import SwiftUI

struct MentionCandidates: View {
    @Environment(AppPreferences.self) private var preferences
    let candidates: [NativeOption]
    let selected: Int
    let choose: (NativeOption) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(preferences.text("项目 Skill / 插件", "Project skills / plugins")).font(.caption).foregroundStyle(.secondary).padding(10)
            ForEach(candidates) { candidate in
                Button { choose(candidate) } label: {
                    Label(candidate.title, systemImage: "at")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12)
                        .background(candidates.firstIndex(where: { $0.id == candidate.id }) == selected ? Color.primary.opacity(0.06) : .clear)
                }
                .buttonStyle(.plain)
            }
        }
        .background(AgentTheme.card, in: .rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(AgentTheme.line) }
    }
}
