import Foundation

struct NativeOption: Codable, Identifiable {
    var id: String
    var title: String
    var value: String
    var subtitle: String? = nil
}
