import SwiftUI

/// 定制的悬浮控件采用系统材料；标准导航、表单和弹层由系统直接提供外观。
struct AgentGlassSurface: ViewModifier {
    var cornerRadius: CGFloat = 24
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular.interactive(), in: .rect(cornerRadius: cornerRadius))
        } else {
            content.background(.regularMaterial, in: .rect(cornerRadius: cornerRadius))
        }
    }
}

struct AgentGlassButton: ViewModifier {
    var prominent = false
    var circular = false
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if prominent { content.buttonStyle(.glassProminent).buttonBorderShape(circular ? .circle : .capsule) }
            else { content.buttonStyle(.glass).buttonBorderShape(circular ? .circle : .capsule) }
        } else {
            if prominent { content.buttonStyle(.borderedProminent).buttonBorderShape(circular ? .circle : .capsule) }
            else { content.buttonStyle(.bordered).buttonBorderShape(circular ? .circle : .capsule) }
        }
    }
}

struct AgentGlassGroup<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        if #available(iOS 26.0, *) { GlassEffectContainer(spacing: 12) { content } }
        else { content }
    }
}
