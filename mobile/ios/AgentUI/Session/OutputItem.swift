import Foundation

struct OutputItem: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var name: String
    var kind: OutputKind
    var content = ""
    var data: Data?
    var assetName: String?
    var resourceName: String?
    var remoteURL: String?
    var line: Int?
    var canRetry = true
}
