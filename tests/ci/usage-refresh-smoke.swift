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

        let shanghai = TimeZone(identifier: "Asia/Shanghai")!
        let utc = TimeZone(secondsFromGMT: 0)!
        precondition(UsageFormatting.refreshTime(1792649814, timeZone: shanghai) == "2026/10/22 14:16", "后端Unix秒应显示完整本地日期时间")
        precondition(UsageFormatting.refreshTime(1792649814, timeZone: utc) == "2026/10/22 06:16", "日期时间必须随设备时区转换")
        for invalid: Double? in [nil, 0, -1, .nan, .infinity, -.infinity] {
            precondition(UsageFormatting.refreshTime(invalid, timeZone: shanghai) == nil, "无效刷新时间不能由当前时间或窗口长度推算")
            precondition(AccountQuota(sevenDayResetsAt: invalid).sevenDayResetsAt == nil, "账户模型不能保存无效时间")
        }
        let legacy = try JSONDecoder().decode(AccountQuota.self, from: Data("{\"sevenDayRemaining\":0.52}".utf8))
        precondition(legacy.sevenDayRemaining == 0.52 && legacy.sevenDayResetsAt == nil, "旧账户缓存没有刷新时间时不补造时间")
        let roundtrip = try JSONDecoder().decode(AccountQuota.self, from: JSONEncoder().encode(initialQuota!))
        precondition(roundtrip.sevenDayResetsAt == 1792649814, "真实刷新时间必须支持Codable往返")
        print("Usage refresh smoke passed")
    }
}
