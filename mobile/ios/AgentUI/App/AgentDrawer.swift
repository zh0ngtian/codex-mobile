import SwiftUI

/// 侧栏在主界面后方，整块主界面（包括导航栏和输入区）随手指移动。
struct AgentDrawer<Content: View, Sidebar: View>: View {
    @Binding var isOpen: Bool
    let gesturesEnabled: Bool
    @ViewBuilder let content: Content
    @ViewBuilder let sidebar: Sidebar
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var translation: CGFloat?

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let sidebarWidth = SidebarPresentation.width(in: width)
            let offset = SidebarPresentation.offset(isOpen: isOpen, translation: translation ?? 0, containerWidth: width)
            let progress = offset / max(sidebarWidth, 1)
            ZStack(alignment: .leading) {
                if progress > 0 || isOpen {
                    sidebar
                        .frame(width: sidebarWidth, height: geometry.size.height)
                        .background(AgentTheme.page)
                        .allowsHitTesting(isOpen && translation == nil)
                        .accessibilityHidden(!isOpen)
                }
                content
                    .allowsHitTesting(!isOpen && translation == nil)
                    .accessibilityHidden(isOpen)
                    .frame(width: width, height: geometry.size.height)
                    .background(AgentTheme.page)
                    .clipShape(.rect(cornerRadius: min(56, width * 0.14) * min(1, progress * 8)))
                    .shadow(color: .black.opacity(0.16 * min(1, progress * 3)), radius: 24, x: -6, y: 0)
                    .offset(x: offset)
                if progress > 0 {
                    HStack(spacing: 0) {
                        Color.clear.frame(width: offset).allowsHitTesting(false)
                        Button { isOpen = false } label: {
                            Color.clear.contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(preferences.text("收起会话侧栏", "Close conversation sidebar"))
                        .accessibilityIdentifier("drawer.close-surface")
                    }
                    .frame(width: width, height: geometry.size.height)
                }
            }
            .background(NativeDrawerGestureSurface(isOpen: isOpen, enabled: gesturesEnabled, width: width,
                changed: { translation = $0 }, ended: { target in
                    withAnimation(reduceMotion ? nil : .interactiveSpring(response: 0.5, dampingFraction: 0.88)) {
                        isOpen = target
                        translation = nil
                    }
                }))
            .animation(reduceMotion ? nil : .interactiveSpring(response: 0.5, dampingFraction: 0.88), value: isOpen)
        }
        .ignoresSafeArea()
        .background(AgentTheme.page)
    }
}
