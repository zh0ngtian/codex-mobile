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
        // 系统菜单保留图片画布的宽度，以透明留白增加圆点与文字的间距。
        let image = UIGraphicsImageRenderer(size: CGSize(width: 22, height: 18)).image { _ in
            color.setFill()
            UIBezierPath(ovalIn: CGRect(x: 1, y: 5, width: 8, height: 8)).fill()
        }
        return image.withRenderingMode(.alwaysOriginal)
    }
}
