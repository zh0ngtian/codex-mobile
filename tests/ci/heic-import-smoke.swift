import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

@main struct HEICImportSmoke {
    static func main() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let bytes = Data(repeating: 160, count: 16 * 8 * 4)
        let provider = CGDataProvider(data: bytes as CFData)!
        let image = CGImage(width: 16, height: 8, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 64, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        let encoded = NSMutableData()
        let destination = CGImageDestinationCreateWithData(encoded, UTType.heic.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: 6] as CFDictionary)
        precondition(CGImageDestinationFinalize(destination))
        let url = folder.appendingPathComponent("方向测试.heic")
        try (encoded as Data).write(to: url)
        let item = try await AttachmentLoader().file(at: url, id: UUID())
        precondition(item.name == "方向测试.jpg" && item.mimeType == "image/jpeg" && item.kind == .image)
        let jpeg = item.data!
        precondition(jpeg != encoded as Data && item.byteCount == jpeg.count)
        let source = CGImageSourceCreateWithData(jpeg as CFData, nil)!
        precondition(CGImageSourceGetType(source) as String? == UTType.jpeg.identifier)
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)! as NSDictionary
        precondition(properties[kCGImagePropertyOrientation] as? Int == 6, "JPEG必须保留照片旋转方向")
        precondition(CGImageSourceCreateImageAtIndex(source, 0, nil) != nil, "生成真正可解码JPEG而不是改扩展名")
        let transfer = try await AttachmentPhotoTransfer.importFile(at: url, contentType: .image)
        precondition(transfer.name == "方向测试.jpg" && transfer.mimeType == "image/jpeg")
        do {
            _ = try AttachmentLoader.compatibleImage(data: Data("broken".utf8), name: "bad.heic", type: .heic)
            preconditionFailure("坏HEIC不能冒充普通文件继续发送")
        } catch AttachmentImportError.unreadableImage { }
        print("HEIC import smoke passed")
    }
}
