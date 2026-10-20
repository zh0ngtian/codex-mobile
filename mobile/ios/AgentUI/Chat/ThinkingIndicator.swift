import SwiftUI

struct ThinkingIndicator: View {
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small).tint(.secondary)
            Text(preferences.text("正在执行…", "Working…")).font(.body).foregroundStyle(.secondary)
        }.padding(.vertical, 12).accessibilityElement(children: .combine)
    }
}
