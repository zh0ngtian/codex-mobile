import CoreTransferable
import Foundation
import UniformTypeIdentifiers

struct AttachmentPhotoTransfer: Transferable {
    let data: Data

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            // Read the borrowed file while its transfer callback keeps it valid.
            // No application-owned copy or temporary file is created.
            try await importFile(at: received.file)
        }
    }

    static func importFile(at url: URL) async throws -> AttachmentPhotoTransfer {
        let data = try await AttachmentLoader().imageData(at: url)
        return AttachmentPhotoTransfer(data: data)
    }
}
