import Foundation

struct UsageMetrics: Codable, Equatable, Sendable {
    var lastRequestTokens: Double?
    var contextCapacity: Double? = nil
    var cumulativeInputTokens: Double? = nil
    var cachedInputTokens: Double? = nil
    var cumulativeOutputTokens: Double? = nil

    var contextRemaining: Double? {
        guard let used = lastRequestTokens, let capacity = contextCapacity,
              used.isFinite, capacity.isFinite, used >= 0, capacity > 0, used <= capacity else { return nil }
        return 1 - used / capacity
    }

    private enum CodingKeys: String, CodingKey {
        case lastRequestTokens, contextCapacity, cumulativeInputTokens, cachedInputTokens, cumulativeOutputTokens
    }
}

extension UsageMetrics {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        lastRequestTokens = try values.decodeIfPresent(Double.self, forKey: .lastRequestTokens)
        contextCapacity = try values.decodeIfPresent(Double.self, forKey: .contextCapacity)
        cumulativeInputTokens = try values.decodeIfPresent(Double.self, forKey: .cumulativeInputTokens)
        cachedInputTokens = try values.decodeIfPresent(Double.self, forKey: .cachedInputTokens)
        cumulativeOutputTokens = try values.decodeIfPresent(Double.self, forKey: .cumulativeOutputTokens)
    }
}
