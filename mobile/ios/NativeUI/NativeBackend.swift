import Foundation

struct NativeBackend: Codable, Identifiable {
    var id: String
    var title: String
    var subtitle: String? = nil
    var connected: Bool? = nil
    var gatewayAddress: String? = nil
    var enabled: Bool? = nil
    var connectionState: String? = nil
    var projects: [String]? = nil
    var approvalCount: Int? = nil
    var queuedCount: Int? = nil
}
