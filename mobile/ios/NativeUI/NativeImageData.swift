import Foundation

enum NativeImageData {
    static func data(for source: String) -> Data? {
        guard let comma = source.firstIndex(of: ",") else { return nil }
        let header = source[..<comma].lowercased()
        guard header.hasPrefix("data:image/") else { return nil }
        let content = String(source[source.index(after: comma)...])
        if header.hasSuffix(";base64") { return Data(base64Encoded: content) }
        return content.removingPercentEncoding?.data(using: .utf8)
    }

    static func remoteURL(_ source: String) -> URL? {
        guard let url = URL(string: source), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil else { return nil }
        return url
    }
}
