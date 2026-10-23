import Foundation

struct NativeCommandResult: Codable {
    var id: String
    var name: String
    var value: String? = nil
    var ok: Bool
    var contextId: String? = nil
    var error: String? = nil
    var fieldKey: String? = nil
    var fieldRevision: Int? = nil
}
