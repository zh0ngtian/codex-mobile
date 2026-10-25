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
            TimelineView(.periodic(from: .now, by: 60)) { context in
                UsageRow(title: preferences.text("刷新时间", "Refresh time"), value: UsageFormatting.refreshTime(quota?.sevenDayResetsAt, now: context.date) ?? noData)
            }
            UsageRow(title: preferences.text("输入 Token", "Input tokens"), value: inputValue)
            UsageRow(title: preferences.text("输出 Token", "Output tokens"), value: UsageFormatting.tokens(metrics?.cumulativeOutputTokens) ?? noData)
            UsageRow(title: preferences.text("最近请求上传", "Latest request upload"), value: UsageFormatting.bytes(metrics?.lastRequestBytes) ?? noData)
                .accessibilityHint(preferences.text("模型请求载荷大小，不含 HTTP 头、WebSocket 帧和 TLS/TCP 开销", "Model request payload, excluding HTTP headers, WebSocket frames and TLS/TCP overhead"))
            UsageRow(title: preferences.text("本轮累计上传", "Turn upload total"), value: UsageFormatting.bytes(metrics?.turnUploadBytes) ?? noData)
                .accessibilityHint(preferences.text("本轮全部模型请求载荷，包含工具续跑和重试", "All model request payloads in this turn, including tool continuations and retries"))
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
        let cacheText = preferences.text("缓存 \(cached)", "Cache \(cached)")
        return "\(tokens) (\(cacheText))"
    }
}
