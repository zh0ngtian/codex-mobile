import Foundation

struct NativePanel: Codable, Identifiable {
    var id: String
    var title: String
    var items: [NativePanelItem]
    var dismissible: Bool? = nil
}
