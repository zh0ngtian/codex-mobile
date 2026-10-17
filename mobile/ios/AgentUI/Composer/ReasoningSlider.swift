import SwiftUI

struct ReasoningSlider: View {
    @Environment(AppPreferences.self) private var preferences
    let levelCount: Int
    let selected: Int
    let title: String
    let accent: Color
    let select: (Int) -> Void

    var body: some View {
        GeometryReader { geometry in
            let travel = max(0, geometry.size.width - 44)
            let segment = travel / CGFloat(max(1, levelCount - 1))
            let offset = CGFloat(selected) * segment
            ZStack(alignment: .leading) {
                Capsule().fill(AgentTheme.ink.opacity(0.06)).frame(height: 34)
                Capsule().fill(accent).frame(width: offset + 22, height: 34)
                ForEach(0..<levelCount, id: \.self) { index in
                    Circle()
                        .fill(index <= selected ? .white.opacity(0.3) : AgentTheme.ink.opacity(0.16))
                        .frame(width: 5, height: 5)
                        .offset(x: 19.5 + CGFloat(index) * segment)
                }
                Circle()
                    .fill(.white)
                    .overlay { Circle().strokeBorder(.black.opacity(0.055), lineWidth: 1) }
                    .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
                    .frame(width: 40, height: 40)
                    .offset(x: offset + 2)
            }
            .frame(height: 44)
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                guard levelCount > 1, travel > 0 else { return }
                let fraction = min(1, max(0, (value.location.x - 22) / travel))
                select(Int((fraction * CGFloat(levelCount - 1)).rounded()))
            })
            .accessibilityElement()
            .accessibilityLabel(preferences.text("思考强度", "Reasoning effort"))
            .accessibilityValue(title)
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: select(min(levelCount - 1, selected + 1))
                case .decrement: select(max(0, selected - 1))
                @unknown default: break
                }
            }
            .accessibilityIdentifier("reasoning.slider")
        }
        .frame(height: 44)
        .disabled(levelCount < 2)
    }
}
