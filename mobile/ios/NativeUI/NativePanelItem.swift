import Foundation

struct NativePanelItem: Codable, Identifiable {
    var id: String
    var kind: String
    var title: String? = nil
    var text: String? = nil
    var value: String? = nil
    var values: [String]? = nil
    var options: [NativeOption]? = nil
    var command: NativeCommand? = nil
    var children: [NativePanelItem]? = nil
    var disabled: Bool? = nil
    var previewURL: String? = nil
}
