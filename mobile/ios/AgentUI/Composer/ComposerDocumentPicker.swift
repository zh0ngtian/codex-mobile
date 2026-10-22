import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 附件只需读取导入副本；避免打开原文件时的跨应用书签与兼容签名身份冲突。
struct ComposerDocumentPicker: UIViewControllerRepresentable {
    let completion: (Result<[URL], Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = context.coordinator
        picker.view.accessibilityIdentifier = "composer.attachments.file-picker"
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--agent-document-import-fixture") {
            picker.directoryURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        }
        #endif
        return picker
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    @MainActor final class Coordinator: NSObject, UIDocumentPickerDelegate {
        private var completion: ((Result<[URL], Error>) -> Void)?

        init(completion: @escaping (Result<[URL], Error>) -> Void) { self.completion = completion }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            finish(.success(urls))
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(.success([])) }

        private func finish(_ result: Result<[URL], Error>) {
            let callback = completion
            completion = nil
            callback?(result)
        }
    }
}
