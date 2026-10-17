import Foundation

struct AccountQuota: Codable, Equatable, Sendable {
    var sevenDayRemaining: Double?
    var fiveHourRemaining: Double?

    init(sevenDayRemaining: Double? = nil, fiveHourRemaining: Double? = nil) {
        self.sevenDayRemaining = UsageFormatting.validFraction(sevenDayRemaining)
        self.fiveHourRemaining = UsageFormatting.validFraction(fiveHourRemaining)
    }

    private enum CodingKeys: String, CodingKey { case sevenDayRemaining, fiveHourRemaining }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(sevenDayRemaining: try values.decodeIfPresent(Double.self, forKey: .sevenDayRemaining), fiveHourRemaining: try values.decodeIfPresent(Double.self, forKey: .fiveHourRemaining))
    }
}
