import SwiftUI

struct PreviewCodeView: View {
    @Environment(AppPreferences.self) private var preferences
    let source: String
    var targetLine: Int?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(PreviewSourceLine.lines(from: source)) { line in
                        HStack(alignment: .top, spacing: 14) {
                            Text(line.id, format: .number.grouping(.never))
                                .foregroundStyle(line.id == targetLine ? AgentTheme.ink : .secondary)
                                .frame(minWidth: 34, alignment: .trailing)
                                .accessibilityHidden(true)
                            Text(line.text.isEmpty ? " " : line.text)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .font(.system(.body, design: .monospaced))
                        .padding(.horizontal, 14).padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(line.id == targetLine ? Color.primary.opacity(0.07) : .clear)
                        .id(line.id)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(preferences.text("第 \(line.id) 行，\(line.text)", "Line \(line.id), \(line.text)"))
                    }
                }
                .padding(.vertical, 12)
            }
            .task(id: targetLine) {
                if let targetLine, targetLine > 0 { proxy.scrollTo(targetLine, anchor: .center) }
            }
        }
        .background(AgentTheme.code)
    }
}
