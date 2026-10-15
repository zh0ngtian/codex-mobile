import SwiftUI

struct NativePageBackground: View {
    var focused = false
    var body: some View {
        LinearGradient(stops: [
            .init(color: NativePalette.canvas, location: 0),
            .init(color: NativePalette.canvas, location: focused ? 0.38 : 0.66),
            .init(color: NativePalette.composerBackdrop, location: focused ? 0.78 : 0.86),
            .init(color: NativePalette.composerBackdrop, location: 1)
        ], startPoint: .top, endPoint: .bottom)
            // 延伸到状态栏和 home indicator，但保留系统键盘给出的可用高度。
            .ignoresSafeArea(.container)
    }
}
