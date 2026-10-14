import Foundation

struct NativeNavigationItem: Codable, Identifiable {
    var id: String
    var title: String
    var subtitle: String? = nil
    var badge: String? = nil
    var selected: Bool? = nil
    var command: NativeCommand? = nil
}
