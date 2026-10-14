import Foundation

struct NativeMessage: Codable, Identifiable {
    var id: String
    var role: String
    var text: String
    var status: String? = nil
    var blocks: [NativePanelItem]? = nil
    var actions: [NativePanelItem]? = nil
}
