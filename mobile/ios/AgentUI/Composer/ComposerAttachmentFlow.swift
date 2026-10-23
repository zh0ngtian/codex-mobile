import Foundation
import Observation
import PhotosUI
import SwiftUI

struct ComposerAttachmentSelection: Equatable {
    let id = UUID()
    let contextID: String
    let composerID: UUID
}

@MainActor @Observable
final class ComposerAttachmentFlow {
    private let imports = AttachmentImportStore()
    private(set) var selection: ComposerAttachmentSelection?
    private(set) var error: String?
    private(set) var isCommitting = false
    private(set) var isLocating = false
    var items: [AttachmentItem] { imports.items }
    var isBusy: Bool { imports.isProcessing || isCommitting || isLocating }
    var canSelect: Bool { !isBusy && items.isEmpty }
    var canRetry: Bool { !isBusy && !items.isEmpty && items.allSatisfy { $0.state == .ready } }

    func begin(in session: AppSession) -> ComposerAttachmentSelection? {
        guard canSelect, session.composerCanEdit, session.historyEdit == nil, !session.sidebarVisible,
              let contextID = session.nativeSnapshot.contextId else { return nil }
        let value = ComposerAttachmentSelection(contextID: contextID, composerID: session.composer.id)
        selection = value
        error = nil
        return value
    }

    func isCurrent(_ value: ComposerAttachmentSelection, in session: AppSession) -> Bool {
        matchesScope(value, in: session) && session.composerCanEdit && session.historyEdit == nil
    }

    func loadFiles(_ urls: [URL], selection: ComposerAttachmentSelection, in session: AppSession, isEnglish: Bool) async -> Bool {
        guard isCurrent(selection, in: session), !Task.isCancelled, !urls.isEmpty else { return false }
        imports.addFiles(urls, isEnglish: isEnglish, existingByteCount: existingBytes(in: session))
        await imports.waitForCompletion()
        return await commit(selection: selection, in: session, isEnglish: isEnglish)
    }

    func loadPhotos(_ photos: [PhotosPickerItem], selection: ComposerAttachmentSelection, in session: AppSession, isEnglish: Bool) async -> Bool {
        guard isCurrent(selection, in: session), !Task.isCancelled, !photos.isEmpty else { return false }
        imports.addPhotos(photos, isEnglish: isEnglish, existingByteCount: existingBytes(in: session))
        await imports.waitForCompletion()
        return await commit(selection: selection, in: session, isEnglish: isEnglish)
    }

    func retry(in session: AppSession, isEnglish: Bool) async -> Bool {
        guard canRetry, let selection else { return false }
        return await commit(selection: selection, in: session, isEnglish: isEnglish)
    }

    func insertLocation(selection: ComposerAttachmentSelection, in session: AppSession, isEnglish: Bool, authorize: @MainActor () async -> Bool) async -> Bool {
        guard isCurrent(selection, in: session), !Task.isCancelled else { return false }
        isLocating = true
        defer { if self.selection == selection { isLocating = false } }
        let allowed = await authorize()
        guard isCurrent(selection, in: session), !Task.isCancelled else { return false }
        guard allowed else {
            isLocating = false
            error = isEnglish ? "Location access was not granted. Your input is preserved." : "定位权限未授权，已保留现有输入。"
            return false
        }
        let inserted = await session.request("location.insert", ["contextId": .string(selection.contextID)])
        guard matchesScope(selection, in: session), !Task.isCancelled else { return false }
        isLocating = false
        if inserted { self.selection = nil; error = nil }
        else { error = session.lastErrorMessage ?? (isEnglish ? "Could not get your location. Try again." : "无法获取当前位置，请重试。") }
        return inserted
    }

    func cancelSelection(_ value: ComposerAttachmentSelection) { if selection == value { selection = nil } }
    func pickerFailed(_ message: String, selection: ComposerAttachmentSelection, in session: AppSession) {
        guard isCurrent(selection, in: session) else { return }
        error = message
    }
    func remove(_ id: UUID) {
        guard !isCommitting else { return }
        imports.remove(id)
        if items.isEmpty { reset() }
        else { error = items.first { $0.state == .failed }?.error }
    }
    func reset() { imports.reset(); selection = nil; error = nil; isCommitting = false; isLocating = false }

    private func existingBytes(in session: AppSession) -> Int { AttachmentImportLimits.retainedBytes(in: session.composer.attachments) }
    private func matchesScope(_ value: ComposerAttachmentSelection, in session: AppSession) -> Bool {
        selection == value && session.nativeSnapshot.contextId == value.contextID && session.composer.id == value.composerID
    }

    private func commit(selection: ComposerAttachmentSelection, in session: AppSession, isEnglish: Bool) async -> Bool {
        guard isCurrent(selection, in: session), !Task.isCancelled, !isCommitting, !items.isEmpty, !imports.isProcessing else { return false }
        guard items.allSatisfy({ $0.state == .ready }) else {
            error = items.first { $0.state == .failed }?.error ?? (isEnglish ? "Remove failed attachments and retry." : "请移除失败的附件后重试。")
            return false
        }
        guard imports.checkCommitBudget(existingByteCount: existingBytes(in: session), isEnglish: isEnglish) else {
            error = items.first { $0.state == .failed }?.error
            return false
        }
        error = nil
        isCommitting = true
        defer { if self.selection == selection { isCommitting = false } }
        let imported = await session.importAttachmentsAndWait(items, contextID: selection.contextID)
        guard matchesScope(selection, in: session), !Task.isCancelled else { return false }
        isCommitting = false
        if imported { imports.reset(); self.selection = nil }
        else { error = session.lastErrorMessage ?? (isEnglish ? "Attachments could not be added. Try again." : "附件未能添加，请重试。") }
        return imported
    }
}
