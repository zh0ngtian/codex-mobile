import SwiftUI

struct AttachmentOption: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: symbol).font(.title2)
                Text(title).font(.body)
            }
            .foregroundStyle(AgentTheme.ink)
            .frame(maxWidth: .infinity, minHeight: 88)
            .background(AgentTheme.code, in: .rect(cornerRadius: 20))
        }
        .buttonStyle(.plain)
    }
}
