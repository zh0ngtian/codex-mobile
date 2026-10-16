import SwiftUI

struct NativeContextUsageButton: View {
    let store: NativeUIStore
    @State private var detailsOpen = false

    var body: some View {
        Button { detailsOpen.toggle() } label: {
            ZStack {
                Circle().stroke(.primary.opacity(0.14), lineWidth: 2.6)
                if let percent = store.snapshot.contextUsage?.safeUsedPercent, percent > 0 {
                    Circle().trim(from: 0, to: percent / 100)
                        .stroke(.primary, style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            }.frame(width: 28, height: 28).frame(width: 44, height: 44).contentShape(.rect)
        }
        .accessibilityLabel(store.label("查看用量与额度", "View Usage and Limits"))
        .accessibilityValue(store.snapshot.contextUsage?.safeUsedPercent.map { store.label("上下文已用 \(Int($0.rounded()))%", "Context used \(Int($0.rounded()))%") } ?? store.label("暂无上下文用量", "Context usage unavailable"))
        .accessibilityIdentifier("native-context-usage")
        .popover(isPresented: $detailsOpen, arrowEdge: .top) {
            NativeUsageDetailsView(store: store)
                .presentationBackground(NativePalette.canvas)
                .presentationCompactAdaptation(.popover)
        }
    }
}
