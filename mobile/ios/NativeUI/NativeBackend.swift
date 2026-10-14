import Foundation

struct NativeBackend: Codable, Identifiable {
    var id: String
    var title: String
    var subtitle: String? = nil
    var connected: Bool? = nil
}
