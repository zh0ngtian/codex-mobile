import UIKit
import WebKit

// 仅由 configure-ios-tests.rb 加入模拟器测试工程，普通构建不包含此文件。
final class KeyboardLayoutProbeWebView: CodexMobileWebView {
    private var observers: [NSObjectProtocol] = []
    private var displayLink: CADisplayLink?
    private var measuringDismissal = false
    private var maximumHeightDifference: CGFloat = 0
    private let probeLabel = UILabel()

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        probeLabel.frame = CGRect(x: 0, y: 64, width: 1, height: 1)
        probeLabel.isAccessibilityElement = true
        probeLabel.accessibilityIdentifier = "codex.keyboard-dismissal-height-difference"
        probeLabel.accessibilityLabel = "0"
        observers = [
            NotificationCenter.default.addObserver(
                forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main
            ) { [weak self] _ in self?.beginMeasurement() },
            NotificationCenter.default.addObserver(
                forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main
            ) { [weak self] _ in self?.finishMeasurement() },
        ]
    }

    required init?(coder: NSCoder) { fatalError("测试探针不支持 storyboard") }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        displayLink?.invalidate()
    }

    private func beginMeasurement() {
        maximumHeightDifference = 0
        measuringDismissal = true
        window?.addSubview(probeLabel)
        probeLabel.accessibilityLabel = "0"
        displayLink?.invalidate()
        let link = CADisplayLink(target: self, selector: #selector(measureHeightDifference))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func finishMeasurement() {
        measureHeightDifference()
        measuringDismissal = false
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func measureHeightDifference() {
        guard measuringDismissal, let presentation = layer.presentation() else { return }
        maximumHeightDifference = max(maximumHeightDifference, abs(bounds.height - presentation.bounds.height))
        probeLabel.accessibilityLabel = String(format: "%.2f", Double(maximumHeightDifference))
    }
}
