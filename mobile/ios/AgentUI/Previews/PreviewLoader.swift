import Foundation
import UIKit
import AVFoundation

enum PreviewLoader {
    @MainActor static func load(_ item: OutputItem) async throws -> LoadedPreview {
        let suppliedData: Data?
        if let data = item.data { suppliedData = data }
        else if let source = item.remoteURL { suppliedData = try await remoteData(source) }
        else { suppliedData = nil }
        if item.kind == .image {
            let image: UIImage?
            if let suppliedData { image = UIImage(data: suppliedData) }
            else if let name = item.assetName { image = UIImage(named: name) }
            else if let url = resourceURL(item.resourceName) { image = UIImage(contentsOfFile: url.path) }
            else { image = nil }
            if let source = item.remoteURL, let data = suppliedData,
               NativeImageData.needsWebRenderer(source, title: item.name),
               NativeImageData.webImageHTML(source, title: item.name) != nil {
                return LoadedPreview(data: data, image: image, webImageSource: source)
            }
            guard let image, let data = suppliedData ?? image.jpegData(compressionQuality: 0.95) else {
                throw PreviewLoadError.invalidImage
            }
            return LoadedPreview(data: data, image: image)
        }
        if item.kind == .video {
            if let url = resourceURL(item.resourceName) {
                guard try await AVURLAsset(url: url).load(.isPlayable) else { throw PreviewLoadError.invalidVideo }
                return LoadedPreview(data: try Data(contentsOf: url), videoURL: url)
            }
            guard let data = suppliedData else { throw PreviewLoadError.invalidVideo }
            let suffix = (item.name as NSString).pathExtension
            let url = FileManager.default.temporaryDirectory.appending(path: "preview-\(item.id).\(suffix.isEmpty ? "mp4" : suffix)")
            try data.write(to: url, options: .atomic)
            guard try await AVURLAsset(url: url).load(.isPlayable) else { throw PreviewLoadError.invalidVideo }
            return LoadedPreview(data: data, videoURL: url)
        }
        let data: Data
        if let suppliedData { data = suppliedData }
        else if let resourceName = item.resourceName {
            guard let url = resourceURL(resourceName) else { throw PreviewLoadError.missingResource }
            data = try Data(contentsOf: url)
        } else {
            data = Data(item.content.utf8)
        }
        if item.kind != .binary && String(data: data, encoding: .utf8) == nil {
            throw PreviewLoadError.unsupportedEncoding
        }
        return LoadedPreview(data: data)
    }

    private static func remoteData(_ source: String) async throws -> Data {
        if source.hasPrefix("data:"), let comma = source.firstIndex(of: ",") {
            let metadata = source[..<comma]
            let content = String(source[source.index(after: comma)...])
            let data = metadata.hasSuffix(";base64") ? Data(base64Encoded: content) : content.removingPercentEncoding?.data(using: .utf8)
            guard let data else { throw PreviewLoadError.missingResource }
            return data
        }
        guard let url = NativeImageData.remoteURL(source) else { throw PreviewLoadError.missingResource }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw PreviewLoadError.missingResource
        }
        try Task.checkCancellation()
        return data
    }

    private static func resourceURL(_ name: String?) -> URL? {
        guard let name else { return nil }
        let path = name as NSString
        return Bundle.main.url(forResource: path.deletingPathExtension, withExtension: path.pathExtension)
            ?? Bundle.main.url(forResource: path.deletingPathExtension, withExtension: path.pathExtension, subdirectory: "Resources")
    }
}
