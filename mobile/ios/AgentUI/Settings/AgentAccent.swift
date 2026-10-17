import SwiftUI

enum AgentAccent: String, CaseIterable, Identifiable {
    case blue = "Blue", cyan = "Cyan", green = "Green", lime = "Lime"
    case yellow = "Yellow", orange = "Orange", pink = "Pink"
    case magenta = "Magenta", purple = "Purple", black = "Black"

    var id: String { rawValue }
    var foreground: Color {
        switch self {
        case .black: AgentTheme.page
        case .lime, .yellow, .cyan: .black
        default: .white
        }
    }
    var color: Color {
        switch self {
        case .blue: Color(red: 0.27, green: 0.43, blue: 0.91)
        case .cyan: Color(red: 0.20, green: 0.69, blue: 0.83)
        case .green: Color(red: 0.27, green: 0.68, blue: 0.42)
        case .lime: Color(red: 0.66, green: 0.80, blue: 0.20)
        case .yellow: Color(red: 0.92, green: 0.75, blue: 0.13)
        case .orange: Color(red: 0.96, green: 0.50, blue: 0.19)
        case .pink: Color(red: 0.96, green: 0.25, blue: 0.68)
        case .magenta: Color(red: 0.77, green: 0.28, blue: 0.74)
        case .purple: Color(red: 0.56, green: 0.38, blue: 0.85)
        case .black: AgentTheme.ink
        }
    }
}
