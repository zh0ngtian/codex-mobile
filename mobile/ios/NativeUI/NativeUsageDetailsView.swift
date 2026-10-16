import SwiftUI

struct NativeUsageDetailsView: View {
    let store: NativeUIStore

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text(store.label("用量与额度", "Usage and Limits")).modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .subheadline))
            if let usage = store.snapshot.contextUsage, let usedPercent = usage.safeUsedPercent {
                NativeUsageDetailRow(title: store.label("上下文余量", "Context Remaining"), value: percent(100 - usedPercent))
                    .accessibilityHint(store.label("已用 \(count(usage.safeUsed)) / \(count(usage.total))", "Used \(count(usage.safeUsed)) / \(count(usage.total))"))
            } else {
                NativeUsageDetailRow(title: store.label("上下文余量", "Context Remaining"), value: store.label("暂无数据", "Unavailable"))
            }
            NativeUsageDetailRow(title: store.label("周期剩余", "Cycle Remaining"), value: store.snapshot.sevenDayRateLimit?.safeRemainingPercent.map(percent) ?? store.label("暂无数据", "Unavailable"))
                .accessibilityHint(store.label("后端提供的 7 天额度剩余", "Remaining limit in the backend's 7-day window"))
            NativeUsageDetailRow(title: store.label("时间剩余", "Time Remaining"), value: store.snapshot.fiveHourRateLimit?.safeRemainingPercent.map(percent) ?? store.label("暂无数据", "Unavailable"))
                .accessibilityHint(store.label("后端提供的 5 小时额度剩余", "Remaining limit in the backend's 5-hour window"))
            NativeUsageDetailRow(title: store.label("输入 Token", "Input Tokens"), value: inputTokenValue)
            NativeUsageDetailRow(title: store.label("输出 Token", "Output Tokens"), value: store.snapshot.outputTokenUsage ?? store.label("暂无数据", "Unavailable"))
        }
        .font(.caption).padding(16).frame(idealWidth: 300)
        .accessibilityIdentifier("native-usage-details")
    }

    private var inputTokenValue: String {
        guard let input = store.snapshot.inputTokenUsage else { return store.label("暂无数据", "Unavailable") }
        guard let hit = store.snapshot.inputCacheHitPercent else {
            return store.label("\(input) (缓存 暂无数据)", "\(input) (Cache unavailable)")
        }
        let percentage = hit.formatted(.number.precision(.fractionLength(0...1)))
        return store.label("\(input) (缓存 \(percentage)%)", "\(input) (Cache \(percentage)%)")
    }

    private func percent(_ value: Double) -> String { "\(Int(value.rounded()))%" }
    private func count(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0))) }
}
