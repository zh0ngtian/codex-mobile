import SwiftUI

struct CodeCard: View {
    @Environment(AppPreferences.self) private var preferences
    let code: String
    var language = "Code"
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(language).font(AgentTheme.small)
                Spacer()
                Button(copied ? preferences.text("已复制", "Copied") : preferences.text("复制代码", "Copy code"),
                       systemImage: copied ? "checkmark" : "square.on.square", action: copy)
                    .labelStyle(.iconOnly).font(.body).frame(width: 44, height: 44)
            }
            ScrollView(.horizontal) {
                Text(code).font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color(red: 0.19, green: 0.43, blue: 0.14))
                    .textSelection(.enabled).padding(.vertical, 8)
            }.scrollIndicators(.hidden)
        }
        .padding(.horizontal, 16).padding(.vertical, 7)
        .background(AgentTheme.code, in: .rect(cornerRadius: 21))
        .overlay { RoundedRectangle(cornerRadius: 21).strokeBorder(AgentTheme.line, lineWidth: 0.5) }
    }
    private func copy() { Clipboard.copy(code); copied = true }
}
