import UIKit
import WebKit
import PhotosUI
import UniformTypeIdentifiers

/// 只安装到应用主 WebView，直接打开附件对应的原生选择器。
final class CodexMobileAttachmentPickerBridge: NSObject, WKScriptMessageHandler,
    PHPickerViewControllerDelegate, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private weak var webView: WKWebView?
    private var pendingID: String?

    static func configure(_ webView: WKWebView) {
        let bridge = CodexMobileAttachmentPickerBridge()
        bridge.webView = webView
        let controller = webView.configuration.userContentController
        controller.add(bridge, name: "attachmentPicker")
        controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    // 返回 FileList 给原 input，复用已有附件校验、上传和预览。
    static let script = """
    (() => {
      window.codexMobileAttachmentsDispose?.();
      const pending = new Map();
      let sequence = 0;
      const nextID = () => Date.now().toString(36) + '-' + (++sequence);
      const decodeFiles = files => (files || []).map(file => {
        const binary = atob(file.data);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return new File([bytes], file.name, { type: file.type });
      });
      window.codexMobilePickAttachments = kind => new Promise((resolve, reject) => {
        const handler = window.webkit?.messageHandlers?.attachmentPicker;
        if (!handler || !['photos', 'files'].includes(kind)) { reject(new Error('附件选择器不可用')); return; }
        const id = nextID();
        pending.set(id, { resolve, reject });
        try { handler.postMessage({ id, kind, multiple: true }); }
        catch (error) { pending.delete(id); reject(error); }
      });
      const click = event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.disabled ||
            !input.matches('.attachment-picker input[type="file"]')) return;
        const handler = window.webkit?.messageHandlers?.attachmentPicker;
        if (!handler) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = nextID();
        pending.set(id, input);
        const types = input.accept.split(',').map(type => type.trim().toLowerCase()).filter(Boolean);
        handler.postMessage({ id, kind: types.length && types.every(type => type.startsWith('image/') || type.startsWith('video/')) ? 'photos' : 'files', multiple: input.multiple });
      };
      window.codexMobileAttachmentsComplete = result => {
        const route = pending.get(result.id);
        pending.delete(result.id);
        if (!route) return;
        if (route.resolve) {
          if (result.error) { route.reject(new Error(result.error)); return; }
          try { route.resolve(decodeFiles(result.files)); } catch (error) { route.reject(error); }
          return;
        }
        const input = route;
        if (!input.isConnected || !result.files?.length || result.error) return;
        const transfer = new DataTransfer();
        for (const file of decodeFiles(result.files)) transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      document.addEventListener('click', click, true);
      window.codexMobileAttachmentsDispose = () => {
        document.removeEventListener('click', click, true);
        for (const route of pending.values()) route.reject?.(new Error('附件选择已结束'));
        pending.clear();
      };
    })();
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, webView?.url?.isFileURL == true,
              let body = message.body as? [String: Any], let id = body["id"] as? String,
              let kind = body["kind"] as? String, kind == "photos" || kind == "files" else { return }
        guard pendingID == nil, let presenter = presenter(), presenter.presentedViewController == nil else {
            reply(id: id, files: [], error: "已有选择器正在使用，请关闭后重试")
            return
        }
        pendingID = id
        let multiple = body["multiple"] as? Bool ?? false
        let picker: UIViewController
        if kind == "photos" {
            var configuration = PHPickerConfiguration()
            configuration.filter = .any(of: [.images, .videos])
            configuration.selectionLimit = multiple ? 0 : 1
            configuration.selection = .ordered
            configuration.preferredAssetRepresentationMode = .current
            let photos = PHPickerViewController(configuration: configuration)
            photos.delegate = self
            photos.view.accessibilityIdentifier = "codex.attachments.photos"
            picker = photos
        } else {
            let documents = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            documents.allowsMultipleSelection = multiple
            documents.delegate = self
            documents.view.accessibilityIdentifier = "codex.attachments.files"
            picker = documents
        }
        presenter.present(picker, animated: true) { picker.presentationController?.delegate = self }
    }

    private func presenter() -> UIViewController? {
        var responder: UIResponder? = webView
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard let id = pendingID else { return }
        picker.dismiss(animated: true) { self.loadPhotos(results, index: 0, files: [], id: id) }
    }

    private func loadPhotos(_ results: [PHPickerResult], index: Int, files: [[String: String]], id: String) {
        guard pendingID == id else { return }
        guard index < results.count else { finish(id: id, files: files); return }
        let provider = results[index].itemProvider
        let identifier = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .movie) == true }
            ?? provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true }
        guard let identifier, let type = UTType(identifier) else {
            finish(id: id, files: [], error: "无法读取所选照片或视频"); return
        }
        if type.conforms(to: .movie) {
            let suggestedName = provider.suggestedName
            let usedBytes = files.reduce(0) { total, file in
                let encoded = file["data"] ?? ""
                return total + encoded.count / 4 * 3 - (encoded.hasSuffix("==") ? 2 : encoded.hasSuffix("=") ? 1 : 0)
            }
            let availableBytes = max(0, AttachmentImportLimits.totalBytes - usedBytes)
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak self] url, error in
                do {
                    guard let url else { throw error ?? AttachmentImportError.missingData }
                    let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                    guard values.isRegularFile == true, let size = values.fileSize else { throw AttachmentImportError.fileSizeUnavailable }
                    // The provider owns this URL only for the duration of the callback.
                    let data = try AttachmentLoader.readBoundedFile(url, size: size, availableBytes: availableBytes)
                    let originalName = suggestedName ?? url.lastPathComponent
                    let fileType = UTType(filenameExtension: url.pathExtension)
                    let nameType = UTType(filenameExtension: (originalName as NSString).pathExtension)
                    let actualType = [fileType, nameType, type].compactMap { $0 }.first { $0.conforms(to: .movie) } ?? type
                    let ext = actualType.preferredFilenameExtension
                    var name = originalName
                    if (name as NSString).pathExtension.isEmpty, let ext, !ext.isEmpty { name += ".\(ext)" }
                    let file = ["name": name, "type": actualType.preferredMIMEType ?? "application/octet-stream", "data": data.base64EncodedString()]
                    DispatchQueue.main.async { self?.loadPhotos(results, index: index + 1, files: files + [file], id: id) }
                } catch {
                    DispatchQueue.main.async { self?.finish(id: id, files: [], error: AttachmentImportError.message(for: error, isEnglish: false)) }
                }
            }
            return
        }
        provider.loadDataRepresentation(forTypeIdentifier: identifier) { [weak self] data, error in
            var file: [String: String]?
            if let data, let type = UTType(identifier) {
                let mime = type.preferredMIMEType ?? ""
                let supported = ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(mime)
                let bytes = supported ? data : UIImage(data: data)?.jpegData(compressionQuality: 0.95)
                if let bytes {
                    let ext = supported ? (type.preferredFilenameExtension ?? "jpg") : "jpg"
                    let name = provider.suggestedName ?? "图片-\(index + 1)"
                    let stem = (name as NSString).deletingPathExtension
                    file = ["name": "\(stem).\(ext)", "type": supported ? mime : "image/jpeg", "data": bytes.base64EncodedString()]
                }
            }
            let selectedFile = file
            DispatchQueue.main.async {
                guard let self else { return }
                guard let selectedFile else {
                    self.finish(id: id, files: [], error: error?.localizedDescription ?? "无法读取所选图片")
                    return
                }
                self.loadPhotos(results, index: index + 1, files: files + [selectedFile], id: id)
            }
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let id = pendingID else { return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let files = try urls.map { url -> [String: String] in
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url)
                    let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    return ["name": url.lastPathComponent, "type": mime, "data": data.base64EncodedString()]
                }
                DispatchQueue.main.async { self?.finish(id: id, files: files) }
            } catch {
                DispatchQueue.main.async { self?.finish(id: id, files: [], error: error.localizedDescription) }
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let id = pendingID { finish(id: id, files: []) }
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if let id = pendingID { finish(id: id, files: []) }
    }

    private func finish(id: String, files: [[String: String]], error: String? = nil) {
        guard pendingID == id else { return }
        pendingID = nil
        reply(id: id, files: files, error: error)
        if let error, let presenter = presenter() {
            let alert = UIAlertController(title: "无法读取附件", message: error, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "确定", style: .default))
            presenter.present(alert, animated: true)
        }
    }

    private func reply(id: String, files: [[String: String]], error: String? = nil) {
        var result: [String: Any] = ["id": id, "files": files]
        if let error { result["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.codexMobileAttachmentsComplete?.(\(json))", completionHandler: nil)
    }
}
