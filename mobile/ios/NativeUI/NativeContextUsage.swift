import Foundation

struct NativeContextUsage: Codable {
    var used: Double
    var total: Double
    var usedPercent: Double
    var remainingPercent: Double

    var safeUsedPercent: Double? {
        guard used.isFinite, total.isFinite, total > 0 else { return nil }
        return min(100, max(0, used / total * 100))
    }
    var safeUsed: Double { min(max(0, total), max(0, used.isFinite ? used : 0)) }
}
