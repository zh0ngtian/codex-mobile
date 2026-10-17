import SwiftUI

struct NativeFileDownloadView: View {
    let source: String
    let title: String
    @Environment(\.locale) private var locale
    @State private var downloading = false
    @State private var error: String?
    @State private var savedFile: URL?
    @State private var temporaryDirectory: URL?
    @State private var pickerOpen = false
    @State private var task: Task<Void, Never>?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(downloading ? label("正在下载…", "Downloading…") : label("下载文件", "Download File"), systemImage: "arrow.down.doc") {
                task = Task { await download() }
            }.disabled(downloading)
            if let error { Text(error).font(.body).foregroundStyle(.red).textSelection(.enabled) }
        }
        .fileMover(isPresented: $pickerOpen, file: savedFile) { result in
            if case .failure(let reason) = result { error = reason.localizedDescription }
            cleanup()
        } onCancellation: { cleanup() }
        .onChange(of: source) { task?.cancel(); cleanup(); error = nil }
        .onDisappear { task?.cancel(); if !pickerOpen { cleanup() } }
    }
    private func download() async {
        downloading = true; error = nil
        defer { downloading = false }
        do {
            guard let url = NativeImageData.remoteURL(source) else { throw URLError(.unsupportedURL) }
            let (file, response) = try await URLSession.shared.download(from: url)
            defer { try? FileManager.default.removeItem(at: file) }
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-download-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            temporaryDirectory = directory
            let rawName = (title.isEmpty ? response.suggestedFilename ?? "file" : title) as NSString
            let name = rawName.lastPathComponent
            let target = directory.appendingPathComponent(name.isEmpty || name == "." || name == ".." ? "file" : name)
            try FileManager.default.moveItem(at: file, to: target)
            savedFile = target; pickerOpen = true
        } catch {
            cleanup()
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
    private func cleanup() {
        if let temporaryDirectory { try? FileManager.default.removeItem(at: temporaryDirectory) }
        temporaryDirectory = nil; savedFile = nil
    }
    private func label(_ chinese: String, _ english: String) -> String { locale.identifier.hasPrefix("zh") ? chinese : english }
}
