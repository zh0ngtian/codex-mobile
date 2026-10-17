import SwiftUI

struct SettingsRow: View {
    let title: String
    let symbol: String
    var value: String? = nil
    var disclosure = true

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 16)).frame(width: 20)
            Text(title).font(AgentTheme.body)
            Spacer(minLength: 10)
            if let value { Text(value).font(AgentTheme.body).foregroundStyle(.secondary).lineLimit(1) }
            if disclosure { Image(systemName: "chevron.right").font(.footnote.bold()).foregroundStyle(.tertiary) }
        }
        .foregroundStyle(AgentTheme.ink)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, minHeight: 49, alignment: .leading)
        .contentShape(.rect)
    }
}
