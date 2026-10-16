import Foundation

struct NativeRateLimit: Codable {
    var remainingPercent: Double
    var resetsAt: Double? = nil
    var windowDurationMins: Double? = nil

    var safeRemainingPercent: Double? {
        guard remainingPercent.isFinite else { return nil }
        return min(100, max(0, remainingPercent))
    }

    func remainingTimePercent(at date: Date) -> Double? {
        guard let resetsAt, resetsAt.isFinite, resetsAt > 0,
              let windowDurationMins, windowDurationMins.isFinite, windowDurationMins > 0 else { return nil }
        return min(100, max(0, (resetsAt - date.timeIntervalSince1970) / (windowDurationMins * 60) * 100))
    }
}
