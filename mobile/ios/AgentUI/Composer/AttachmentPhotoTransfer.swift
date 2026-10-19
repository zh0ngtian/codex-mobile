import CoreTransferable
import Foundation
import UniformTypeIdentifiers

struct AttachmentPhotoTransfer: Transferable {
    let data: Data
    let name: String
    let kind: AttachmentKind
    let mimeType: String?

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            try await importFile(at: received.file, contentType: .movie)
        }
        FileRepresentation(importedContentType: .image) { received in
            // Read the borrowed file while its transfer callback keeps it valid.
            // No application-owned copy or temporary file is created.
            try await importFile(at: received.file, contentType: .image)
        }
    }

    static func importFile(at url: URL, contentType: UTType? = nil) async throws -> AttachmentPhotoTransfer {
        let item = try await AttachmentLoader().file(at: url, id: UUID(), contentType: contentType ?? UTType(filenameExtension: url.pathExtension) ?? .image)
        guard let data = item.data, !data.isEmpty else { throw AttachmentImportError.missingData }
        return AttachmentPhotoTransfer(data: data, name: item.name, kind: item.kind, mimeType: item.mimeType)
    }
}
