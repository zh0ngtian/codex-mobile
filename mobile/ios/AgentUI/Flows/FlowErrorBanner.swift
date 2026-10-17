import SwiftUI

struct FlowErrorBanner: View {
    @Environment(AppPreferences.self) private var preferences
    let message: String

    var body: some View {
        Label(preferences.runtimeText(message), systemImage: "exclamationmark.circle.fill")
            .font(.subheadline)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
    }
}
