import SwiftUI

struct ReasoningSlider: View {
    @Environment(AppPreferences.self) private var preferences
    let levelCount: Int
    let selected: Int
    let title: String
    let accent: Color
    let select: (Int) -> Void
    var body: some View {
        Slider(value: Binding(get: { Double(selected) }, set: { select(Int($0.rounded())) }),
               in: 0...Double(max(1, levelCount - 1)), step: 1) {
            Text(title)
        }
        .labelsHidden()
        .tint(accent)
        .frame(minHeight: 44)
        .disabled(levelCount < 2)
        .accessibilityLabel(preferences.text("思考强度", "Reasoning effort"))
        .accessibilityValue(title)
        .accessibilityIdentifier("reasoning.slider")
    }
}
