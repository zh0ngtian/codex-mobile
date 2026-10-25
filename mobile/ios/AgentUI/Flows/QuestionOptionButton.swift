import SwiftUI

struct QuestionOptionButton: View {
    let title: String
    var detail = ""
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.body)
                    .foregroundStyle(selected ? AgentTheme.ink : Color.secondary)
                    .accessibilityHidden(true)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.body)
                        .foregroundStyle(.primary)
                    if !detail.isEmpty {
                        Text(detail)
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .background(selected ? AgentTheme.ink.opacity(0.07) : AgentTheme.page, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(selected ? AgentTheme.ink.opacity(0.6) : AgentTheme.line)
            }
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
