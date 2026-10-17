import SwiftUI

struct UsagePopover: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    let conversationID: UUID?
    let deviceID: UUID?
    let dismiss: () -> Void
    private var metrics: UsageMetrics? { conversationID.flatMap(session.conversation)?.usage }
    private var quota: AccountQuota? { session.accountQuota(for: deviceID) }
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text(preferences.text("用量与额度", "Usage and limits")).font(.body)
            UsageRow(title: preferences.text("上下文余量", "Context remaining"), value: percentage(metrics?.contextRemaining))
            UsageRow(title: preferences.text("额度剩余", "Quota remaining"), value: percentage(quota?.sevenDayRemaining))
            UsageRow(title: preferences.text("时间剩余", "Time remaining"), value: percentage(quota?.fiveHourRemaining))
            UsageRow(title: preferences.text("输入 Token", "Input tokens"), value: inputValue)
            UsageRow(title: preferences.text("输出 Token", "Output tokens"), value: UsageFormatting.tokens(metrics?.cumulativeOutputTokens) ?? noData)
        }
        .padding(20).frame(width: 310)
        .accessibilityIdentifier("usage.card")
        .background { EscapeKeyHandler(action: dismiss).frame(width: 1, height: 1) }
        .presentationCompactAdaptation(.popover)
    }
    private var noData: String { preferences.text("暂无数据", "No data available") }
    private func percentage(_ value: Double?) -> String { UsageFormatting.percentage(value) ?? noData }
    private var inputValue: String {
        let tokens = UsageFormatting.tokens(metrics?.cumulativeInputTokens) ?? noData
        let cached = UsageFormatting.cachePercentage(input: metrics?.cumulativeInputTokens, cached: metrics?.cachedInputTokens)
        guard let cached else { return tokens }
        let cacheText = preferences.text("缓存命中 \(cached)", "Cache hit \(cached)")
        return "\(tokens) (\(cacheText))"
    }
}
