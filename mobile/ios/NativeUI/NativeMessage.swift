import Foundation

struct NativeMessage: Codable, Identifiable {
    var id: String
    var role: String
    var text: String
    var status: String? = nil
    var blocks: [NativePanelItem]? = nil
    var actions: [NativePanelItem]? = nil
    var timestamp: Double? = nil
    var historyEdit: NativePanel? = nil
    var turnId: String? = nil
    var itemId: String? = nil
    var phase: String? = nil
}
