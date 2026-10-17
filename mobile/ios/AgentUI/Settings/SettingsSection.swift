import SwiftUI

struct SettingsSection<Content: View>: View {
    let title: String
    var topSpacing: CGFloat = 28
    @ContentBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.body).foregroundStyle(.secondary).padding(.horizontal, 16)
            VStack(spacing: 0) { content }
                .background(AgentTheme.card, in: .rect(cornerRadius: 24))
        }
        .padding(.top, topSpacing)
    }
}
