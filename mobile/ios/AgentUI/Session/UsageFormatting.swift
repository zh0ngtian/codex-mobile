import Foundation

enum UsageFormatting {
    static func tokens(_ value: Double?) -> String? {
        guard let value, value.isFinite, value >= 0 else { return nil }
        if value >= 1_000_000 || value / 1_000 >= 999.95 { return decimal(value / 1_000_000) + "M" }
        if value >= 1_000 || value >= 999.95 { return decimal(value / 1_000) + "K" }
        return decimal(value)
    }

    static func percentage(_ value: Double?) -> String? {
        guard let value = validFraction(value) else { return nil }
        return String(Int((value * 100).rounded())) + "%"
    }

    static func cachePercentage(input: Double?, cached: Double?) -> String? {
        guard let input, let cached, input.isFinite, cached.isFinite,
              input > 0, cached >= 0, cached <= input else { return nil }
        return decimal(cached / input * 100) + "%"
    }

    static func validFraction(_ value: Double?) -> Double? {
        guard let value, value.isFinite, (0...1).contains(value) else { return nil }
        return value
    }

    private static func decimal(_ value: Double) -> String {
        if value == 0 { return "0" }
        let rounded = value <= Double.greatestFiniteMagnitude / 10 ? (value * 10).rounded() / 10 : value
        return rounded.formatted(.number.locale(Locale(identifier: "en_US_POSIX"))
            .precision(.fractionLength(0...1)).grouping(.never))
    }
}
