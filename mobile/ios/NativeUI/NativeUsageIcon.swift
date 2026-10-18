import SwiftUI

/// 全部原生页面共用同一个 SF Symbol，不以绘制的圆环替代。
struct NativeUsageIcon: View {
    var body: some View {
        Image(systemName: "circle")
            .fontWeight(.regular)
            .foregroundStyle(.black)
            .background(.white, in: .circle)
    }
}
