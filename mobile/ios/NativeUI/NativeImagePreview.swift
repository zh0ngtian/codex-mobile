import SwiftUI
import UniformTypeIdentifiers
import ImageIO

struct NativeImagePreview: View {
    let source: String
    let title: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var retry = 0
    @State private var webHTML: String?
    @State private var image: UIImage?
    @State private var error: String?
    @State private var exportDocument: NativeFileDocument?
    @State private var exportType: UTType = .png
    @State private var exportOpen = false
    @State private var exportError: String?

    var body: some View {
        NavigationStack {
            VStack {
                Group {
                    if let webHTML {
                        NativeHTMLWebView(html: webHTML, onOpenLink: { _ in })
                    } else if let image {
                        NativeZoomableImage(image: image, title: title)
                    } else if let error {
                        VStack(spacing: 16) {
                            Text(error)
                            Button(label("重试", "Retry")) { retry += 1 }
                        }.padding()
                    } else { ProgressView(label("正在加载原图…", "Loading original image…")).padding() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(label("完成", "Done")) { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(label("下载原图", "Save Original"), systemImage: "arrow.down.doc") { exportOpen = true }
                        .disabled(exportDocument == nil)
                }
            }
            .task(id: retry, load)
            .onChange(of: source) { retry += 1 }
            .fileExporter(isPresented: $exportOpen, document: exportDocument, contentType: exportType, defaultFilename: title.isEmpty ? "image" : title) { result in
                if case .failure(let error) = result { exportError = error.localizedDescription }
            }
            .alert(label("无法保存图片", "Unable to Save Image"), isPresented: exportErrorBinding) {
                Button(label("确定", "OK")) { exportError = nil }
            } message: { Text(exportError ?? "") }
        }
    }

    private func load() async {
        error = nil; image = nil; webHTML = nil
        exportDocument = nil
        do {
            let data: Data
            var mime = NativeImageData.mimeType(source)
            if let local = NativeImageData.data(for: source) { data = local }
            else if let url = NativeImageData.remoteURL(source) {
                let (bytes, response) = try await URLSession.shared.data(from: url)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                data = bytes
                mime = response.mimeType
            } else { throw URLError(.unsupportedURL) }
            guard !Task.isCancelled else { return }
            if NativeImageData.needsWebRenderer(source, title: title) || ["image/svg+xml", "image/gif", "image/webp", "image/avif"].contains(mime ?? "") {
                let contentType = mime ?? UTType(filenameExtension: (title as NSString).pathExtension)?.preferredMIMEType ?? "image/svg+xml"
                webHTML = NativeImageData.webImageHTML("data:\(contentType);base64,\(data.base64EncodedString())", title: title)
                guard webHTML != nil else { throw URLError(.cannotDecodeContentData) }
            } else {
                guard let decoded = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
                image = decoded
            }
            if let source = CGImageSourceCreateWithData(data as CFData, nil), let type = CGImageSourceGetType(source) {
                exportType = UTType(type as String) ?? .image
            } else { exportType = mime.flatMap { UTType(mimeType: $0) } ?? .image }
            exportDocument = NativeFileDocument(data: data)
        } catch {
            if !Task.isCancelled { self.error = "\(label("原图加载失败", "Unable to load the original image"))：\(error.localizedDescription)" }
        }
    }
    private var exportErrorBinding: Binding<Bool> { Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } }) }
    private func label(_ chinese: String, _ english: String) -> String { locale.identifier.hasPrefix("zh") ? chinese : english }
}
