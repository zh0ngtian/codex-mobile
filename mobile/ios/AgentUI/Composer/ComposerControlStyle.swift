import SwiftUI

/// 参考输入栏共用的34pt圆形/胶囊表面，交互继续由原有菜单负责。
struct ComposerControlSurface: ViewModifier {
    static let fill = Color.primary.opacity(0.085)
    var circular = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, circular ? 0 : 8)
            .frame(width: circular ? 34 : nil, height: 34)
            .background(Self.fill, in: .capsule)
            .frame(height: 44)
            .contentShape(.rect)
    }
}
