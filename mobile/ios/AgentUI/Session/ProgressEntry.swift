import Foundation

struct ProgressEntry: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var text: String
    var createdAt: Date? = nil
    var outputs: [OutputItem]?
    var timestampLabel: String {
        guard let createdAt else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: createdAt)
    }
}
