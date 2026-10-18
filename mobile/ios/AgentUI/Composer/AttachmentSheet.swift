import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct AttachmentSheet: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let add: ([AttachmentItem]) async -> Bool
    let insertLocation: (String) -> Void
    @State private var imports = AttachmentImportStore()
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var photosPresented = false
    @State private var filesPresented = false
    @State private var locationSelected = false
    @State private var locationAuthorization = NativeLocationAuthorization()
    @State private var pickerError = false
    @State private var committing = false
    @State private var importError: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(preferences.text("选择图片", "Choose images"), systemImage: "photo.on.rectangle", action: choosePhotos)
                    Button(preferences.text("选择文件", "Choose files"), systemImage: "folder", action: chooseFiles)
                    if pickerError {
                        Label(preferences.text("无法打开所选文件。已保留现有输入，请重新选择。", "Could not open the selected files. Your input is preserved; choose again."), systemImage: "exclamationmark.triangle")
                            .font(.body).foregroundStyle(.secondary)
                    }
                } header: { Text(preferences.text("从本机添加", "Add from your device")) }
                footer: { Text(preferences.text("附件内存上限：单个文件 20 MiB，输入框已有附件与待添加附件合计 40 MiB。", "Attachment memory limit: 20 MiB per file, 40 MiB total for existing and staged input attachments.")) }
                if let importError {
                    Label(importError, systemImage: "exclamationmark.triangle").font(.body).foregroundStyle(.red)
                }
                if !imports.items.isEmpty {
                    Section {
                        ForEach(imports.items) { item in
                            StagedAttachmentRow(item: item) { imports.remove(item.id) }
                        }
                        if imports.items.contains(where: { $0.state == .failed }) {
                            Text(preferences.text("请移除失败的附件后继续添加。", "Remove failed attachments before adding the remaining files."))
                                .font(.body).foregroundStyle(.secondary)
                        }
                    } header: { Text(preferences.text("待添加附件", "Attachments to add")) }
                }
                Section {
                    Button(locationSelected ? preferences.text("已选择当前位置", "Current location selected") : preferences.text("选择当前位置", "Select current location"), systemImage: locationSelected ? "checkmark.circle.fill" : "plus.circle", action: chooseLocation)
                    if locationSelected {
                        Button(preferences.text("移除位置", "Remove location"), role: .destructive, action: removeLocation)
                    }
                } header: { Text(preferences.text("位置", "Location")) }
                footer: { Text(preferences.text("选择当前位置时请求定位权限，添加后将坐标、地图链接和精度插入输入框。定位失败时保留现有输入。", "Selecting your location requests permission. Adding inserts coordinates, a map link, and accuracy into the composer. Your input is preserved if location fails.")) }
            }
            .disabled(committing)
            .navigationTitle(preferences.text("添加到对话", "Add to conversation"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(preferences.text("取消", "Cancel"), action: cancel).disabled(committing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(preferences.text("添加", "Add")) { Task { await commit() } }
                        .disabled((imports.items.isEmpty && !locationSelected) || imports.isProcessing || committing || imports.items.contains { $0.state == .failed })
                }
            }
            .fileImporter(isPresented: $filesPresented, allowedContentTypes: [.item], allowsMultipleSelection: true, onCompletion: filesSelected)
            .photosPicker(isPresented: $photosPresented, selection: $selectedPhotos, matching: .images, preferredItemEncoding: .current)
            .onChange(of: selectedPhotos, photoSelectionChanged)
            .onDisappear(perform: disappeared)
            .interactiveDismissDisabled(committing)
        }
    }

    private func choosePhotos() { selectedPhotos = []; photosPresented = true }
    private func chooseFiles() { filesPresented = true }
    private func disappeared() { if !photosPresented && !filesPresented { imports.cancelAll() } }
    private func photoSelectionChanged(_ oldValue: [PhotosPickerItem], _ newValue: [PhotosPickerItem]) {
        guard !newValue.isEmpty else { return }
        let added = newValue.filter { !oldValue.contains($0) }
        imports.addPhotos(added, isEnglish: preferences.isEnglish, existingByteCount: existingAttachmentBytes)
    }
    private func filesSelected(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls): pickerError = false; imports.addFiles(urls, isEnglish: preferences.isEnglish, existingByteCount: existingAttachmentBytes)
        case .failure(let error):
            if (error as NSError).code != CocoaError.userCancelled.rawValue { pickerError = true }
        }
    }
    private func chooseLocation() { locationAuthorization.request(); locationSelected = true }
    private func removeLocation() { locationSelected = false }
    private func cancel() { imports.cancelAll(); dismiss() }
    private func commit() async {
        guard !committing else { return }
        committing = true
        defer { committing = false }
        importError = nil
        guard imports.checkCommitBudget(existingByteCount: existingAttachmentBytes, isEnglish: preferences.isEnglish) else { return }
        if !imports.items.isEmpty {
            guard await add(imports.items) else {
                importError = session.toast ?? preferences.text("附件未能添加，请重试。", "Attachments could not be added. Try again.")
                return
            }
        }
        if locationSelected { session.nativeStore?.command("location.insert") }
        dismiss()
    }
    private var existingAttachmentBytes: Int { AttachmentImportLimits.retainedBytes(in: session.composer.attachments) }
}
