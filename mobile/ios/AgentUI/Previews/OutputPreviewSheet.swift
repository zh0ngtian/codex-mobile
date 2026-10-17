import SwiftUI
import UniformTypeIdentifiers

struct OutputPreviewSheet: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    let item: OutputItem
    @State private var selectedTab = PreviewTab.preview
    @State private var loaded: LoadedPreview?
    @State private var error: String?
    @State private var isLoading = true
    @State private var retryCount = 0
    @State private var exporting = false
    @State private var exportDocument: PreviewFileDocument?
    @State private var actionMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "internaldrive")
                    Text(preferences.text("文件预览", "File preview"))
                    Spacer()
                    if let loaded { Text(ByteCountFormatter.string(fromByteCount: Int64(loaded.data.count), countStyle: .file)) }
                }
                .font(.body).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 10)
                if supportsTabs {
                    Picker(preferences.text("显示方式", "Display mode"), selection: $selectedTab) {
                        Text(preferences.text("预览", "Preview")).tag(PreviewTab.preview)
                        Text(preferences.text("源码", "Source")).tag(PreviewTab.source)
                    }
                    .pickerStyle(.segmented).padding(.horizontal, 20).padding(.bottom, 12)
                }
                Divider()
                if isLoading {
                    ProgressView(preferences.text("正在读取文件…", "Reading file…"))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    PreviewErrorView(message: error, canRetry: item.canRetry, retry: retry)
                } else if let loaded {
                    OutputPreviewBody(item: item, loaded: loaded, selectedTab: selectedTab)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if let actionMessage {
                    Text(actionMessage).font(.body).foregroundStyle(.secondary)
                        .padding(12).frame(maxWidth: .infinity)
                        .background(.thinMaterial).accessibilityAddTraits(.updatesFrequently)
                }
            }
            .background(AgentTheme.page)
            .navigationTitle(item.name).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(preferences.text("关闭", "Close"), systemImage: "xmark", action: close)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if supportsCopy {
                        Button(preferences.text("复制源码", "Copy source"), systemImage: "document.on.document", action: copySource)
                            .disabled(loaded == nil)
                    }
                    if item.kind != .web {
                        Button(preferences.text("下载", "Download"), systemImage: "arrow.down.to.line", action: download)
                            .disabled(loaded == nil)
                    }
                }
            }
            .fileExporter(isPresented: $exporting, document: exportDocument, contentType: exportType,
                          defaultFilename: item.name, onCompletion: exported)
            .task(id: item.id.uuidString + "-" + String(retryCount), load)
        }
    }

    private var supportsTabs: Bool { [.markdown, .html, .mermaid].contains(item.kind) }
    private var supportsCopy: Bool { [.text, .code, .markdown, .html, .mermaid].contains(item.kind) }
    private var exportType: UTType { UTType(filenameExtension: (item.name as NSString).pathExtension) ?? .data }

    private func load() async {
        isLoading = true
        error = nil
        loaded = nil
        do {
            let result = try await PreviewLoader.load(item)
            guard !Task.isCancelled else { return }
            loaded = result
        } catch PreviewLoadError.unsupportedEncoding {
            error = preferences.text("文件不是受支持的 UTF-8 文本，无法读取预览。", "This file is not supported UTF-8 text and could not be previewed.")
        } catch {
            self.error = preferences.text("无法读取文件。请检查连接、文件是否存在及格式后重试。", "Could not read the file. Check the connection, file availability, and format, then retry.")
        }
        isLoading = false
    }

    private func retry() { retryCount += 1 }
    private func close() { dismiss() }
    private func copySource() {
        guard let loaded, let source = String(data: loaded.data, encoding: .utf8) else { return }
        Clipboard.copy(source)
        actionMessage = preferences.text("已复制源码", "Source copied")
    }
    private func download() {
        guard let loaded else { return }
        exportDocument = PreviewFileDocument(data: loaded.data)
        exporting = true
    }
    private func exported(_ result: Result<URL, Error>) {
        switch result {
        case .success:
            actionMessage = preferences.text("文件已保存", "File saved")
        case .failure(let error):
            guard (error as NSError).code != CocoaError.userCancelled.rawValue else { return }
            actionMessage = preferences.text("文件保存失败，请重试。", "Could not save the file. Try again.")
        }
    }
}
