import SwiftUI

struct AccentMenuLabel: View {
    @Environment(\.self) private var environment
    @Environment(AppPreferences.self) private var preferences
    let accent: AgentAccent

    var body: some View {
        Label {
            Text(preferences.accentName(accent))
        } icon: {
            if let swatch { Image(uiImage: swatch).renderingMode(.original) }
        }
    }

    // Native menu labels flatten SwiftUI symbol styles; preserve the SF Symbol's color in its image.
    private var swatch: UIImage? {
        let resolved = accent.color.resolve(in: environment)
        let color = UIColor(red: CGFloat(resolved.red), green: CGFloat(resolved.green), blue: CGFloat(resolved.blue), alpha: 1)
        return UIImage(systemName: "circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 7))?
            .withTintColor(color, renderingMode: .alwaysOriginal)
    }
}
