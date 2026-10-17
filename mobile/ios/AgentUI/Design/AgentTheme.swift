import SwiftUI

enum AgentTheme {
    static let page = Color("PageBackground")
    static let settings = Color("SettingsBackground")
    static let card = Color("CardBackground")
    static let code = Color("CodeBackground")
    static let ink = Color("PrimaryText")
    static let line = Color.primary.opacity(0.09)
    static let margin: CGFloat = 20
    // 界面文字统一采用系统正文样式，Markdown 自行表达加粗与标题层级。
    static let body = Font.body
    static let chatBody = Font.body
    static let sectionTitle = Font.body
    static let small = Font.body
    static let caption = Font.body
    static let sidebarDetail = Font.body
}
