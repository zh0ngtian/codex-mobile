import SwiftUI

/// 混合输入由 NativeUIBridge 在唯一业务 WKWebView 内挂载 NativeWebTextEditor。
/// 网页继续拥有表单按钮和弹层；完整原生界面的 NativeComposerView 保持独立。
struct NativeWebComposerHost: View {
    var body: some View { EmptyView() }
}
