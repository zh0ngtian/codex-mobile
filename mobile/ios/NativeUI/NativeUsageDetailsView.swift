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
            NativeUsageDetailRow(title: store.label("对话 Token", "Conversation Tokens"), value: store.snapshot.conversationTokenUsage ?? store.label("暂无数据", "Unavailable"))
        }
        .font(.caption).padding(16).frame(idealWidth: 224)
        .accessibilityIdentifier("native-usage-details")
    }

    private func percent(_ value: Double) -> String { "\(Int(value.rounded()))%" }
    private func count(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0))) }
}
