import Foundation

struct NativeGroup: Codable, Identifiable {
    var id: String
    var title: String
    var items: [NativeNavigationItem]
    var command: NativeCommand? = nil
    var actions: [NativePanelItem]? = nil
    var collapsed: Bool? = nil
}
