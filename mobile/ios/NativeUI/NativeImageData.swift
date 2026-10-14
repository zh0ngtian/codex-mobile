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

    static func mimeType(_ source: String) -> String? {
        guard source.hasPrefix("data:image/"), let comma = source.firstIndex(of: ",") else { return nil }
        return String(source[..<comma].dropFirst(5).split(separator: ";").first ?? "")
    }
    static func needsWebRenderer(_ source: String, title: String) -> Bool {
        if let mime = mimeType(source), ["image/svg+xml", "image/gif", "image/webp", "image/avif"].contains(mime) { return true }
        let components = URLComponents(string: source)
        let path = components?.queryItems?.first(where: { $0.name == "path" })?.value ?? components?.path ?? source
        return [path, title].contains { ["svg", "gif", "webp", "avif"].contains(($0 as NSString).pathExtension.lowercased()) }
    }
    static func webImageHTML(_ source: String, title: String) -> String? {
        guard remoteURL(source) != nil || data(for: source) != nil else { return nil }
        func escape(_ value: String) -> String {
            value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        return "<img src=\"\(escape(source))\" alt=\"\(escape(title))\" style=\"display:block;margin:auto;max-width:100%;max-height:90vh;object-fit:contain\">"
    }
}
