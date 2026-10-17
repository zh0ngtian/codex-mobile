import SwiftUI

struct ReasoningControl: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let openModels: () -> Void
    private var levels: [String] { session.currentCapabilities.levels(for: session.composer.configuration.model) }
    private var selected: Int { min(max(0, Int(session.composer.configuration.reasoning.rounded())), max(0, levels.count - 1)) }
    private var effortTitle: String {
        guard levels.indices.contains(selected) else { return preferences.text("暂无数据", "Unavailable") }
        let level = levels[selected]
        let chinese = ["Low": "低", "Medium": "中", "High": "高", "Extra High": "极高", "Max": "Max", "Ultra": "Ultra"]
        return preferences.text(chinese[level] ?? level, level)
    }
    private var accent: Color {
        preferences.accent == .pink ? Color(red: 233 / 255, green: 93 / 255, blue: 160 / 255) : preferences.accent.color
    }

    var body: some View {
        VStack(spacing: 14) {
            HStack(alignment: .top, spacing: 0) {
                RunSpeedButton()
                    .offset(y: -8)
                Spacer(minLength: 0)
                Button(action: openModels) {
                    VStack(spacing: 6) {
                        Text(effortTitle)
                            .font(.body)
                            .foregroundStyle(accent)
                        HStack(spacing: 4) {
                            Text(session.composer.configuration.model)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.tertiary)
                        }
                        .font(.body)
                        .foregroundStyle(.secondary)
                    }
                    .frame(minHeight: 56)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(preferences.text("选择模型", "Choose model"))
                .accessibilityValue(session.composer.configuration.model + ", " + effortTitle)
                .accessibilityIdentifier("reasoning.model")
                Spacer(minLength: 0)
                Button(action: resetEffort) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .offset(y: -8)
                .accessibilityLabel(preferences.text("重置思考强度", "Reset reasoning effort"))
                .accessibilityIdentifier("reasoning.reset")
            }
            .padding(.horizontal, 8)
            ReasoningSlider(levelCount: levels.count, selected: selected, title: effortTitle, accent: accent, select: selectEffort)
                .padding(.horizontal, 18)
        }
        .padding(.vertical, 16)
        .modifier(AgentGlassSurface(cornerRadius: 26))
    }

    private func selectEffort(_ index: Int) {
        guard levels.indices.contains(index), Double(index) != session.composer.configuration.reasoning else { return }
        session.composer.configuration.reasoning = Double(index)
        session.configurationDidChange()
    }

    private func resetEffort() {
        let model = session.nativeSnapshot.models.first { $0.title == session.composer.configuration.model }
        let options = model?.efforts ?? session.nativeSnapshot.efforts
        let index = options.firstIndex { $0.value == model?.defaultEffort } ?? 0
        selectEffort(index)
    }
}
