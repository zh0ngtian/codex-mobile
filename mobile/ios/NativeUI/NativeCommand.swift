import Foundation

struct NativeCommand: Codable, Identifiable {
    var id = UUID().uuidString
    var name: String
    var params: [String: NativeJSONValue] = [:]
}
