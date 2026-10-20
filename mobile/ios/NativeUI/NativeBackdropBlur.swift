import SwiftUI

/// 纯展示的轻模糊，完整保留 UIKit 背景采样及系统辅助功能适配。
struct NativeBackdropBlur: UIViewRepresentable {
    func makeUIView(context: Context) -> NativeBackdropEffectView { NativeBackdropEffectView() }
    func updateUIView(_ view: NativeBackdropEffectView, context: Context) {}
    static func dismantleUIView(_ view: NativeBackdropEffectView, coordinator: ()) {
        view.stopBlur()
    }
}
