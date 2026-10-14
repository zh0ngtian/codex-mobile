import Foundation

struct NativeAttachment: Codable, Identifiable {
    var id: String
    var name: String
    var detail: String? = nil
    var imageURL: String? = nil
}
