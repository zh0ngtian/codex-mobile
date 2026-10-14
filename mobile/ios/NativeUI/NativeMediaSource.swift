import Foundation

enum NativeMediaSource {
    static func data(_ value: String) -> (mime: String, bytes: Data)? {
        guard value.hasPrefix("data:"), let comma = value.firstIndex(of: ",") else { return nil }
        let metadata = String(value[value.index(value.startIndex, offsetBy: 5)..<comma])
        let parts = metadata.components(separatedBy: ";")
        guard let mime = parts.first, mime.hasPrefix("audio/") || mime.hasPrefix("video/") else { return nil }
        let encoded = String(value[value.index(after: comma)...])
        guard parts.dropFirst().contains("base64"), let bytes = Data(base64Encoded: encoded) else { return nil }
        return (mime, bytes)
    }
}
