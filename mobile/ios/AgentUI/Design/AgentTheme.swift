import SwiftUI
import UIKit

enum AgentTheme {
    static let page = Color("PageBackground")
    static let settings = Color("SettingsBackground")
    static let card = Color("CardBackground")
    static let code = Color("CodeBackground")
    static let ink = Color("PrimaryText")
    static let line = Color.primary.opacity(0.09)
    static let margin: CGFloat = 20
    static let body = font(.body, size: 14.5, baseSize: 17)
    static let chatBody = font(.body, size: 14, baseSize: 17).weight(.semibold)
    static let sectionTitle = font(.body, size: 15, baseSize: 17).bold()
    static let small = font(.subheadline, size: 12.5, baseSize: 15)
    static let caption = font(.caption, size: 10, baseSize: 12)
    static let sidebarDetail = font(.caption, size: 11.5, baseSize: 12)

    /// 新系统沿用原型字体缩放；旧系统用相同系统字族、字号和 Dynamic Type 基准。
    static func font(_ style: Font.TextStyle, size: CGFloat, baseSize: CGFloat, design: Font.Design = .default) -> Font {
        if #available(iOS 26, *) { return .system(style, design: design).scaled(by: size / baseSize) }
        let system = UIFont.systemFont(ofSize: size)
        let descriptor = design == .rounded ? system.fontDescriptor.withDesign(.rounded) ?? system.fontDescriptor : system.fontDescriptor
        return .custom(UIFont(descriptor: descriptor, size: size).fontName, size: size, relativeTo: style)
    }
}
