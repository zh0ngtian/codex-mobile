import Foundation
import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

actor AttachmentLoader {
    func file(at url: URL, id: UUID, availableBytes: Int = AttachmentImportLimits.totalBytes) throws -> AttachmentItem {
        try Task.checkCancellation()
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize else {
            throw AttachmentImportError.fileSizeUnavailable
        }
        try AttachmentImportLimits.validate(byteCount: size, availableBytes: availableBytes)
        let data = try readBoundedFile(url, size: size, availableBytes: availableBytes)
        try Task.checkCancellation()
        let kind = Self.kind(for: url)
        if kind == .image { try validateImage(data) }
        return AttachmentItem(id: id, name: url.lastPathComponent, kind: kind, data: data, mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType, byteCount: data.count)
    }

    func photo(_ item: PhotosPickerItem, id: UUID, name: String,
               availableBytes: Int = AttachmentImportLimits.totalBytes) async throws -> AttachmentItem {
        guard availableBytes > 0 else { throw AttachmentImportError.batchLimit }
        guard let transfer = try await item.loadTransferable(type: AttachmentPhotoTransfer.self) else {
            throw AttachmentImportError.missingData
        }
        try Task.checkCancellation()
        let data = transfer.data
        try AttachmentImportLimits.validate(byteCount: data.count, availableBytes: availableBytes)
        return AttachmentItem(id: id, name: name, kind: .image, data: data, mimeType: item.supportedContentTypes.first?.preferredMIMEType, byteCount: data.count)
    }

    func imageData(at url: URL) throws -> Data {
        let item = try file(at: url, id: UUID(), availableBytes: AttachmentImportLimits.perFileBytes)
        guard let data = item.data, !data.isEmpty else { throw AttachmentImportError.missingData }
        // The provider's borrowed filename may have no image extension.
        try validateImage(data)
        return data
    }

    private func readBoundedFile(_ url: URL, size: Int, availableBytes: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let limit = min(AttachmentImportLimits.perFileBytes, max(0, availableBytes))
        var data = Data()
        data.reserveCapacity(min(size, limit))
        while true {
            try Task.checkCancellation()
            let chunkSize = min(64 * 1_024, limit - data.count + 1)
            guard let chunk = try handle.read(upToCount: chunkSize), !chunk.isEmpty else { break }
            data.append(chunk)
            try AttachmentImportLimits.validate(byteCount: data.count, availableBytes: availableBytes)
        }
        return data
    }

    private func validateImage(_ data: Data) throws {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else {
            throw AttachmentImportError.unreadableImage
        }
    }

    nonisolated static func kind(for url: URL) -> AttachmentKind {
        guard let type = UTType(filenameExtension: url.pathExtension) else { return .file }
        if type.conforms(to: .image) { return .image }
        if type.conforms(to: .movie) { return .video }
        if type.conforms(to: .audio) { return .audio }
        return .file
    }
}
