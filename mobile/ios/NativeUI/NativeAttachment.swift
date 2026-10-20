import Foundation

struct NativeAttachment: Codable, Identifiable {
    var id: String
    var name: String
    var detail: String? = nil
    var imageURL: String? = nil
    var type: String? = nil
    var command: NativeCommand? = nil
    var size: Int? = nil
}
