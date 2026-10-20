import SwiftUI

struct MermaidPreviewView: View {
    @Environment(AppPreferences.self) private var preferences
    let source: String

    var body: some View {
        if let chart = try? MermaidFlowchart.parse(source) {
            ScrollView([.horizontal, .vertical]) {
                MermaidFlowchartView(chart: chart).padding(30)
            }
        } else {
            VStack(spacing: 0) {
                Label(preferences.text("此本地预览支持 TD / TB / LR 的线性流程图。当前语法暂不支持，已显示源码。", "This local preview supports linear TD / TB / LR flowcharts. This syntax is unsupported, so the source is shown."), systemImage: "exclamationmark.triangle")
                    .font(.body).foregroundStyle(.secondary).padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Divider()
                PreviewCodeView(source: source)
            }
        }
    }
}
