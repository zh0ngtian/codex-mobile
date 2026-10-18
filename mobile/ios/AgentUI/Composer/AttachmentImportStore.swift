import Foundation
import Observation
import PhotosUI
import SwiftUI

@MainActor @Observable
final class AttachmentImportStore {
    private(set) var items: [AttachmentItem] = []
    @ObservationIgnored private var tasks: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private let loader = AttachmentLoader()
    @ObservationIgnored private var precedingImport: Task<Void, Never>?
    @ObservationIgnored private var existingByteCount = 0
    var isProcessing: Bool { items.contains { $0.state == .processing } }

    func addFiles(_ urls: [URL], isEnglish: Bool, existingByteCount: Int = 0) {
        self.existingByteCount = max(0, existingByteCount)
        for url in urls {
            let id = UUID()
            items.append(AttachmentItem(id: id, name: url.lastPathComponent, kind: AttachmentLoader.kind(for: url), state: .processing))
            let preceding = precedingImport
            let task = Task {
                await preceding?.value
                guard !Task.isCancelled else { return }
                do { complete(try await loader.file(at: url, id: id, availableBytes: remainingBytes), isEnglish: isEnglish) }
                catch { fail(id, error: error, isEnglish: isEnglish) }
            }
            tasks[id] = task
            precedingImport = task
        }
    }

    func addPhotos(_ photos: [PhotosPickerItem], isEnglish: Bool, existingByteCount: Int = 0) {
        self.existingByteCount = max(0, existingByteCount)
        for photo in photos {
            let id = UUID()
            let suffix = photo.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let name = "Photo-\(id.uuidString.prefix(6)).\(suffix)"
            items.append(AttachmentItem(id: id, name: name, kind: .image, state: .processing))
            let preceding = precedingImport
            let task = Task {
                await preceding?.value
                guard !Task.isCancelled else { return }
                do { complete(try await loader.photo(photo, id: id, name: name, availableBytes: remainingBytes), isEnglish: isEnglish) }
                catch { fail(id, error: error, isEnglish: isEnglish) }
            }
            tasks[id] = task
            precedingImport = task
        }
    }

    func remove(_ id: UUID) { tasks.removeValue(forKey: id)?.cancel(); items.removeAll { $0.id == id } }
    func cancelAll() { for task in tasks.values { task.cancel() }; tasks.removeAll(); precedingImport = nil }
    func reset() { cancelAll(); items.removeAll() }
    func waitForCompletion() async { await precedingImport?.value }

    func checkCommitBudget(existingByteCount: Int, isEnglish: Bool) -> Bool {
        self.existingByteCount = max(0, existingByteCount)
        var available = max(0, AttachmentImportLimits.totalBytes - min(self.existingByteCount, AttachmentImportLimits.totalBytes))
        var accepted = true
        for index in items.indices where items[index].state == .ready {
            let count = items[index].data?.count ?? 0
            do { try AttachmentImportLimits.validate(byteCount: count, availableBytes: available); available -= count }
            catch {
                items[index].data = nil
                items[index].state = .failed
                items[index].error = AttachmentImportError.message(for: error, isEnglish: isEnglish)
                accepted = false
            }
        }
        return accepted
    }

    private var remainingBytes: Int {
        max(0, AttachmentImportLimits.totalBytes - min(existingByteCount, AttachmentImportLimits.totalBytes) - AttachmentImportLimits.retainedBytes(in: items))
    }

    private func complete(_ item: AttachmentItem, isEnglish: Bool) {
        tasks.removeValue(forKey: item.id)
        guard !Task.isCancelled, let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        do {
            try AttachmentImportLimits.validate(byteCount: item.data?.count ?? 0, availableBytes: remainingBytes)
            items[index] = item
        } catch {
            items[index].state = .failed
            items[index].error = AttachmentImportError.message(for: error, isEnglish: isEnglish)
        }
    }
    private func fail(_ id: UUID, error: Error, isEnglish: Bool) {
        tasks.removeValue(forKey: id)
        guard !Task.isCancelled, let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].state = .failed
        items[index].error = AttachmentImportError.message(for: error, isEnglish: isEnglish)
    }
}
