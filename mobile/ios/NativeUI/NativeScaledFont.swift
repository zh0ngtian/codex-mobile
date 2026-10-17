import SwiftUI

struct NativeScaledFont: ViewModifier {
    // 保留业务组件的调用接口，文字不再套用自定义字号、缩放或字重。
    init(size: Double, scale: Double, weight: Font.Weight = .regular, relativeTo: Font.TextStyle = .body) {
    }
    func body(content: Content) -> some View { content.font(.body) }
}
