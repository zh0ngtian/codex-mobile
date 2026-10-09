import UIKit
import WebKit

// 仅由 configure-ios-tests.rb 加入模拟器测试工程，普通构建不包含此文件。
final class KeyboardLayoutProbeWebView: CodexMobileWebView {
    private var observers: [NSObjectProtocol] = []
    private var displayLink: CADisplayLink?
    private var measuringDismissal = false
    private var maximumHeightDifference: CGFloat = 0
    private let probeLabel = UILabel()
    private let sendFocusLabel = UILabel()
    private let geometryLabel = UILabel()
    private let scrollGeometryLabel = UILabel()
    private var maximumScrollGeometryAnimations = 0
    private var maximumGeometryAnimations = 0
    private var measurementCount = 0

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        configuration.userContentController.addUserScript(WKUserScript(source: """
        document.addEventListener('submit', event => {
            if (!event.target.matches('.composer-wrap')) return;
            window.__codexSendFocusProbe = document.activeElement instanceof HTMLTextAreaElement;
        });
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        super.init(frame: frame, configuration: configuration)
        scrollGeometryLabel.frame = CGRect(x: 0, y: 70, width: 1, height: 1)
        scrollGeometryLabel.isAccessibilityElement = true
        scrollGeometryLabel.accessibilityIdentifier = "codex.scroll-geometry-animation-count"
        scrollGeometryLabel.accessibilityLabel = "not-sampled"
        geometryLabel.frame = CGRect(x: 0, y: 68, width: 1, height: 1)
        geometryLabel.isAccessibilityElement = true
        geometryLabel.accessibilityIdentifier = "codex.geometry-animation-count"
        geometryLabel.accessibilityLabel = "not-sampled"
        sendFocusLabel.frame = CGRect(x: 0, y: 66, width: 1, height: 1)
        sendFocusLabel.isAccessibilityElement = true
        sendFocusLabel.accessibilityIdentifier = "codex.send-retained-input-focus"
        sendFocusLabel.accessibilityLabel = "not-submitted"
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
        measurementCount = 0
        maximumGeometryAnimations = 0
        maximumScrollGeometryAnimations = 0
        scrollGeometryLabel.accessibilityLabel = "not-sampled"
        geometryLabel.accessibilityLabel = "not-sampled"
        measuringDismissal = true
        window?.addSubview(probeLabel)
        window?.addSubview(sendFocusLabel)
        window?.addSubview(geometryLabel)
        window?.addSubview(scrollGeometryLabel)
        probeLabel.accessibilityLabel = "0"
        displayLink?.invalidate()
        let link = CADisplayLink(target: self, selector: #selector(measureHeightDifference))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func finishMeasurement() {
        evaluateJavaScript("String(window.__codexSendFocusProbe)") { [weak self] result, _ in
            self?.sendFocusLabel.accessibilityLabel = result as? String ?? "unavailable"
        }
        measuringDismissal = false
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func measureHeightDifference() {
        guard measuringDismissal, let presentation = layer.presentation() else { return }
        measurementCount += 1
        maximumGeometryAnimations = max(maximumGeometryAnimations, geometryAnimationCount(layer))
        geometryLabel.accessibilityLabel = String(maximumGeometryAnimations)
        // WKWebView 本身稳定仍不够：内部 UIScrollView 的 UIKit 动画也会与网页绘制错位。
        maximumScrollGeometryAnimations = max(maximumScrollGeometryAnimations, geometryAnimationCount(scrollView.layer))
        scrollGeometryLabel.accessibilityLabel = String(maximumScrollGeometryAnimations)
        // model / presentation 在事务提交前允许短暂不同；高度差只作诊断，
        // 回归用动画数量和收起后的连续位置采样判断是否存在几何动画或跳动。
        let difference = abs(bounds.height - presentation.bounds.height)
        maximumHeightDifference = max(maximumHeightDifference, difference)
        probeLabel.accessibilityLabel = String(format: "%.2f", Double(maximumHeightDifference))
        probeLabel.accessibilityValue = String(measurementCount)
    }

    private func geometryAnimationCount(_ target: CALayer) -> Int {
        (target.animationKeys() ?? []).filter { key in
            guard let animation = target.animation(forKey: key) as? CAPropertyAnimation,
                  let path = animation.keyPath else { return false }
            return path == "position" || path == "bounds" || path.hasPrefix("bounds.")
        }.count
    }
}
