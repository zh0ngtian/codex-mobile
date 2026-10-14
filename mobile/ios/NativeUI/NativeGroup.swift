import Foundation

struct NativeGroup: Codable, Identifiable {
    var id: String
    var title: String
    var items: [NativeNavigationItem]
}
