import UIKit
import VisionKit

@MainActor
final class NativeQRScannerController: UIViewController, DataScannerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    private let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
    private var completion: ((String?, String?) -> Void)?
    private let chinese: Bool
    init(chinese: Bool, completion: @escaping (String?, String?) -> Void) {
        self.chinese = chinese
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
        title = chinese ? "扫描设备连接二维码" : "Scan Gateway QR Code"
    }
    required init?(coder: NSCoder) { nil }
    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.cancel() })
        addChild(scanner)
        scanner.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scanner.view)
        NSLayoutConstraint.activate([
            scanner.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), scanner.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scanner.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scanner.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        scanner.didMove(toParent: self)
        scanner.delegate = self
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        do { try scanner.startScanning() }
        catch { finish(nil, error.localizedDescription) }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); scanner.stopScanning() }
    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) { consume(addedItems) }
    func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) { consume([item]) }
    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) { finish(nil, error.localizedDescription) }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { complete(nil, chinese ? "已取消扫描" : "Scanning cancelled") }
    private func consume(_ items: [RecognizedItem]) {
        for case .barcode(let barcode) in items {
            if let value = barcode.payloadStringValue { finish(value, nil); return }
        }
    }
    private func cancel() { finish(nil, chinese ? "已取消扫描" : "Scanning cancelled") }
    private func finish(_ value: String?, _ error: String?) {
        guard completion != nil else { return }
        scanner.stopScanning()
        let callback = completion; completion = nil
        if let navigationController { navigationController.dismiss(animated: true) { callback?(value, error) } }
        else { callback?(value, error) }
    }
    private func complete(_ value: String?, _ error: String?) { let callback = completion; completion = nil; callback?(value, error) }
}
