import SwiftUI

struct NativeUsageDetailsView: View {
    let store: NativeUIStore

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            VStack(alignment: .leading, spacing: 13) {
                Text(store.label("用量与额度", "Usage and Limits")).modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .subheadline))
                if let usage = store.snapshot.contextUsage, let usedPercent = usage.safeUsedPercent {
                    NativeUsageDetailRow(title: store.label("上下文余量", "Context Remaining"), value: percent(100 - usedPercent))
                        .accessibilityHint(store.label("已用 \(count(usage.safeUsed)) / \(count(usage.total))", "Used \(count(usage.safeUsed)) / \(count(usage.total))"))
                } else {
                    NativeUsageDetailRow(title: store.label("上下文余量", "Context Remaining"), value: store.label("暂无数据", "Unavailable"))
                }
                if let quota = store.snapshot.sevenDayRateLimit, let remaining = quota.safeRemainingPercent {
                    NativeUsageDetailRow(title: store.label("套餐剩余", "Plan Remaining"), value: percent(remaining))
                        .accessibilityHint(store.label("后端提供的 7 天额度剩余", "Remaining limit in the backend's 7-day window"))
                    if let remainingTime = quota.remainingTimePercent(at: timeline.date) {
                        NativeUsageDetailRow(title: store.label("时间剩余", "Time Remaining"), value: percent(remainingTime))
                    } else {
                        NativeUsageDetailRow(title: store.label("时间剩余", "Time Remaining"), value: store.label("暂无数据", "Unavailable"))
                    }
                } else {
                    NativeUsageDetailRow(title: store.label("套餐剩余", "Plan Remaining"), value: store.label("暂无数据", "Unavailable"))
                    NativeUsageDetailRow(title: store.label("时间剩余", "Time Remaining"), value: store.label("暂无数据", "Unavailable"))
                }
            }
            .font(.caption).padding(16).frame(idealWidth: 224)
        }
        .accessibilityIdentifier("native-usage-details")
    }

    private func percent(_ value: Double) -> String { "\(Int(value.rounded()))%" }
    private func count(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0))) }
}
