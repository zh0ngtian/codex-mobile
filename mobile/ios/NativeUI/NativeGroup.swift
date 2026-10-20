import Foundation

struct NativeGroup: Codable, Identifiable {
    var id: String
    var title: String
    var items: [NativeNavigationItem]
    var command: NativeCommand? = nil
    var actions: [NativePanelItem]? = nil
    var collapsed: Bool? = nil
    var category: String? = nil
    var subtitle: String? = nil
    var loading: String? = nil
    var newCommand: NativeCommand? = nil
    var backendId: String? = nil
    var cwd: String? = nil
    var hasMore: Bool? = nil
    var allItems: [NativeNavigationItem]? = nil
}
