import Foundation

struct AccountQuota: Codable, Equatable, Sendable {
    var sevenDayRemaining: Double?
    var fiveHourRemaining: Double?
    var sevenDayResetsAt: Double?

    init(sevenDayRemaining: Double? = nil, fiveHourRemaining: Double? = nil, sevenDayResetsAt: Double? = nil) {
        self.sevenDayRemaining = UsageFormatting.validFraction(sevenDayRemaining)
        self.fiveHourRemaining = UsageFormatting.validFraction(fiveHourRemaining)
        self.sevenDayResetsAt = sevenDayResetsAt.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
    }

    private enum CodingKeys: String, CodingKey { case sevenDayRemaining, fiveHourRemaining, sevenDayResetsAt }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(sevenDayRemaining: try values.decodeIfPresent(Double.self, forKey: .sevenDayRemaining), fiveHourRemaining: try values.decodeIfPresent(Double.self, forKey: .fiveHourRemaining), sevenDayResetsAt: try values.decodeIfPresent(Double.self, forKey: .sevenDayResetsAt))
    }
}
