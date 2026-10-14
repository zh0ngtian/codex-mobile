import UIKit
import WebKit
import VisionKit
import AVFoundation

@MainActor
final class NativeQRPresenter {
    private var pendingID: String?
    private var completion: ((String?, String?) -> Void)?
    func scan(id: String, webView: WKWebView, chinese: Bool, completion: @escaping (String?, String?) -> Void) {
        guard pendingID == nil else { completion(nil, chinese ? "已有扫描器正在使用" : "A scanner is already open"); return }
        pendingID = id; self.completion = completion
        Task { [weak self, weak webView] in
            guard let self else { return }
            guard let webView else { self.end(id: id, error: chinese ? "窗口已关闭" : "The window closed"); return }
            guard DataScannerViewController.isSupported else { self.end(id: id, error: chinese ? "此设备不支持二维码扫描" : "QR scanning is unavailable on this device"); return }
            let access: Bool
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: access = true
            case .notDetermined: access = await AVCaptureDevice.requestAccess(for: .video)
            default: access = false
            }
            guard access, DataScannerViewController.isAvailable else { self.end(id: id, error: chinese ? "请在系统设置中允许相机访问" : "Allow camera access in Settings"); return }
            guard var presenter = webView.window?.rootViewController else { self.end(id: id, error: chinese ? "窗口尚未就绪，请重试" : "The window is not ready. Please retry."); return }
            while let presented = presenter.presentedViewController { presenter = presented }
            guard !presenter.isBeingDismissed, !presenter.isBeingPresented else { self.end(id: id, error: chinese ? "请关闭当前弹窗后重试" : "Close the current dialog and retry"); return }
            let scanner = NativeQRScannerController(chinese: chinese) { [weak self] value, error in self?.end(id: id, value: value, error: error) }
            let navigation = UINavigationController(rootViewController: scanner)
            presenter.present(navigation, animated: true) { navigation.presentationController?.delegate = scanner }
        }
    }
    private func end(id: String, value: String? = nil, error: String?) {
        guard pendingID == id else { return }
        let callback = completion
        pendingID = nil; completion = nil
        callback?(value, error)
    }
}
