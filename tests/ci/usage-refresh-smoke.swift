import Foundation

@main
struct UsageRefreshSmoke {
    @MainActor static func main() throws {
        let store = NativeUIStore(arguments: [])
        let session = AppSession(store: store)
        var snapshot = NativeSnapshot()
        snapshot.ready = true
        snapshot.connection = "online"
        snapshot.backendId = "gateway-a"
        snapshot.backends = [NativeBackend(id: "gateway-a", title: "设备 A"), NativeBackend(id: "gateway-b", title: "设备 B")]
        // 真实账户只提供七天窗口，不能从不存在的五小时窗口推算刷新时间。
        snapshot.sevenDayRateLimit = NativeRateLimit(remainingPercent: 52, resetsAt: 1792649814, windowDurationMins: 10080)
        session.receive(snapshot)
        let deviceA = session.currentDevice!.id
        let initialQuota = session.accountQuota(for: deviceA)
        precondition(initialQuota != nil, "账户额度不依赖已打开会话，新对话也应保留当前账户刷新时间")
        let quotaA = try JSONSerialization.jsonObject(with: JSONEncoder().encode(initialQuota!)) as! [String: Any]
        precondition(quotaA["sevenDayResetsAt"] as? Double == 1792649814, "原生账户投影必须保留七天窗口的真实刷新时间")
        precondition(quotaA["fiveHourResetsAt"] == nil && quotaA["fiveHourRemaining"] == nil, "缺失的五小时窗口必须保持缺失")

        snapshot.threadId = "thread-a"
        session.receive(snapshot)

        snapshot.backendId = "gateway-b"
        snapshot.threadId = "thread-b"
        snapshot.sevenDayRateLimit = NativeRateLimit(remainingPercent: 80, resetsAt: 1793000000, windowDurationMins: 10080)
        snapshot.fiveHourRateLimit = NativeRateLimit(remainingPercent: 25, resetsAt: 1792267200, windowDurationMins: 300)
        session.receive(snapshot)
        let quotaB = try JSONSerialization.jsonObject(with: JSONEncoder().encode(session.accountQuota(for: session.currentDevice!.id)!)) as! [String: Any]
        precondition(quotaB["sevenDayResetsAt"] as? Double == 1793000000, "只使用七天窗口的真实时间，不能混用五小时窗口")
        precondition(quotaB["fiveHourResetsAt"] == nil, "刷新时间只保留七天窗口")
        let preservedA = try JSONSerialization.jsonObject(with: JSONEncoder().encode(session.accountQuota(for: deviceA)!)) as! [String: Any]
        precondition(preservedA["sevenDayResetsAt"] as? Double == 1792649814, "切换设备不能将其他账户刷新时间写入原账户")

        snapshot.sevenDayRateLimit = nil
        snapshot.fiveHourRateLimit = nil
        session.receive(snapshot)
        let unavailable = try JSONSerialization.jsonObject(with: JSONEncoder().encode(session.accountQuota(for: session.currentDevice!.id)!)) as! [String: Any]
        precondition(unavailable["sevenDayResetsAt"] == nil && unavailable["fiveHourResetsAt"] == nil, "后端未提供数据时不得保留失效时间")
        snapshot.fiveHourRateLimit = NativeRateLimit(remainingPercent: 25, resetsAt: 1792267200, windowDurationMins: 300)
        session.receive(snapshot)
        precondition(session.accountQuota(for: session.currentDevice!.id)?.sevenDayResetsAt == nil, "只有五小时窗口时不能冒充七天刷新时间")

        precondition(UsageFormatting.refreshTime(Date().timeIntervalSince1970 + 111 * 3600 + 30) == "4d15h (66%)", "刷新时间应显示剩余天小时及七天窗口比例")
        let now = Date(timeIntervalSince1970: 1792649814)
        precondition(UsageFormatting.refreshTime(now.timeIntervalSince1970 + 111 * 3600, now: now) == "4d15h (66%)")
        precondition(UsageFormatting.refreshTime(now.timeIntervalSince1970 + 168 * 3600, now: now) == "7d0h (100%)")
        precondition(UsageFormatting.refreshTime(now.timeIntervalSince1970 + 3599, now: now) == "0d0h (1%)", "剩余小时向下取整，百分比按真实剩余秒计算")
        precondition(UsageFormatting.refreshTime(now.timeIntervalSince1970 - 1, now: now) == "0d0h (0%)", "已过期不显示负倒计时")
        for invalid: Double? in [nil, 0, -1, .nan, .infinity, -.infinity, .greatestFiniteMagnitude] {
            precondition(UsageFormatting.refreshTime(invalid, now: now) == nil, "无效刷新时间不补造倒计时")
            if invalid != .greatestFiniteMagnitude { precondition(AccountQuota(sevenDayResetsAt: invalid).sevenDayResetsAt == nil) }
        }
        let legacy = try JSONDecoder().decode(AccountQuota.self, from: Data("{\"sevenDayRemaining\":0.52}".utf8))
        precondition(legacy.sevenDayRemaining == 0.52 && legacy.sevenDayResetsAt == nil, "旧账户缓存没有刷新时间时不补造时间")
        let roundtrip = try JSONDecoder().decode(AccountQuota.self, from: JSONEncoder().encode(initialQuota!))
        precondition(roundtrip.sevenDayResetsAt == 1792649814, "真实刷新时间必须支持Codable往返")
        snapshot.backendId = "gateway-a"
        snapshot.threadId = "thread-a"
        snapshot.tokenUsage = nil
        snapshot.uploadUsage = NativeUploadUsage(lastRequestBytes: 320000, turnBytes: 1800000)
        session.receive(snapshot)
        let uploaded = session.conversation(session.selectedConversationID!)!.usage!
        precondition(uploaded.lastRequestBytes == 320000 && uploaded.turnUploadBytes == 1800000, "上传计量不依赖 Token 回填")
        precondition(uploaded.cumulativeInputTokens == nil)
        let uploadedRoundtrip = try JSONDecoder().decode(UsageMetrics.self, from: JSONEncoder().encode(uploaded))
        precondition(uploadedRoundtrip.turnUploadBytes == 1800000)
        for (value, expected) in [(0.0, "0 B"), (999, "999 B"), (1000, "1 KB"), (320000, "320 KB"), (1800000, "1.8 MB"), (999999, "1 MB")] {
            precondition(UsageFormatting.bytes(value) == expected)
        }
        for value: Double? in [nil, -1, .nan, .infinity, 0.5, .greatestFiniteMagnitude] { precondition(UsageFormatting.bytes(value) == nil) }
        snapshot.uploadUsage = nil
        session.receive(snapshot)
        precondition(session.conversation(session.selectedConversationID!)!.usage == nil, "缺失计量不能保留旧值")
        print("Usage refresh smoke passed")
    }
}
