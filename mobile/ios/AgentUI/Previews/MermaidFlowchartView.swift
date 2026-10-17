import SwiftUI

struct MermaidFlowchartView: View {
    let chart: MermaidFlowchart

    var body: some View {
        let layout = chart.isHorizontal ? AnyLayout(HStackLayout(spacing: 12)) : AnyLayout(VStackLayout(spacing: 12))
        layout {
            ForEach(Array(chart.labels.enumerated()), id: \.offset) { index, label in
                MermaidFlowchartStep(label: label, isFirst: index == 0, isHorizontal: chart.isHorizontal)
            }
        }
    }
}
