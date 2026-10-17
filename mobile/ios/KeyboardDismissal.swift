import UIKit
import WebKit

// 复用系统键盘的真实弹簧参数和起始时间，避免逐帧跨 WebKit 进程传递位置的延迟。
final class CodexMobileKeyboardDismissal: NSObject {
    private weak var webView: WKWebView?
    private let tracker = UIView()
    private var dismissing = false

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        tracker.translatesAutoresizingMaskIntoConstraints = false
        tracker.isUserInteractionEnabled = false
        tracker.accessibilityElementsHidden = true
        NotificationCenter.default.addObserver(self, selector: #selector(begin(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(finish), name: UIResponder.keyboardDidHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(finish), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(finish), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func attach(to window: UIWindow?) {
        let host = window?.rootViewController?.view
        guard tracker.superview !== host else { return }
        finish()
        tracker.removeFromSuperview()
        guard let host else { return }
        host.addSubview(tracker)
        NSLayoutConstraint.activate([
            tracker.topAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor),
            tracker.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            tracker.widthAnchor.constraint(equalToConstant: 1),
            tracker.heightAnchor.constraint(equalToConstant: 1),
        ])
    }

    @objc private func begin(_ notification: Notification) {
        guard !dismissing, let webView, let window = webView.window else { return }
        dismissing = true
        let springs = (tracker.layer.animationKeys() ?? []).compactMap { tracker.layer.animation(forKey: $0) as? CASpringAnimation }
        let spring = springs.last { $0.keyPath == "position" && $0.duration > 0 }
        let duration = spring?.duration ?? (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0)
        let elapsed = spring.map { $0.beginTime > 0 ? max(0, tracker.layer.convertTime(CACurrentMediaTime(), from: nil) - $0.beginTime) : 0 } ?? 0
        let count = max(1, Int(ceil(duration * 120)))
        let frames = (0...count).map { index -> Double in
            if index == count { return 1 }
            guard let spring else { return Double(index) / Double(count) }
            return Self.progress(at: duration * Double(index) / Double(count), spring: spring)
        }
        let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int ?? 0
        let easing = spring != nil ? "linear" : [0: "ease-in-out", 1: "ease-in", 2: "ease-out", 3: "linear"][curve] ?? "ease-in-out"
        let descriptor: [String: Any] = ["startedAt": (Date().timeIntervalSince1970 - elapsed) * 1000,
                                        "duration": max(0, duration) * 1000, "frames": frames, "easing": easing,
                                        "viewportHeight": webView.convert(CGPoint(x: 0, y: window.bounds.maxY), from: window).y,
                                        "bottomInset": window.safeAreaInsets.bottom]
        guard let data = try? JSONSerialization.data(withJSONObject: descriptor), let payload = String(data: data, encoding: .utf8) else { finish(); return }
        webView.evaluateJavaScript("""
        ((timing) => {
            const input = document.activeElement;
            const composer = document.querySelector('.composer-wrap');
            if (composer && !window.__codexKeyboardDismissal) {
                const previousTop = composer.getBoundingClientRect().top;
                const previousHeight = window.innerHeight;
                const originalTop = composer.style.top;
                const originalBottom = composer.style.bottom;
                let animation, lastTarget, timeout, frame;
                let completed = false;
                const finish = () => {
                    if (completed) return;
                    completed = true;
                    clearTimeout(timeout);
                    cancelAnimationFrame(frame);
                    window.removeEventListener('resize', synchronize);
                    window.visualViewport?.removeEventListener('resize', synchronize);
                    composer.style.top = originalTop;
                    composer.style.bottom = originalBottom;
                    animation?.cancel();
                    if (window.__codexKeyboardDismissal === state) delete window.__codexKeyboardDismissal;
                };
                const synchronize = () => {
                    const elapsed = Math.max(0, Date.now() - timing.startedAt);
                    if (elapsed >= timing.duration) { if (!animation) finish(); return; }
                    if (window.innerHeight <= previousHeight + 1) return;
                    // safe-area-inset-bottom 在收起后改变，目标按当前 CSS 计算。
                    composer.style.bottom = originalBottom;
                    const cssBottom = parseFloat(getComputedStyle(composer).bottom) || 0;
                    const edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--browser-edge-bottom')) || 8;
                    const bottom = Math.max(cssBottom, (timing.bottomInset || 0) + edge);
                    composer.style.bottom = 'auto';
                    // WebKit 可能先只恢复到附件工具栏上沿；终点始终使用原生完整视口。
                    const target = (timing.viewportHeight || window.innerHeight) - composer.offsetHeight - bottom;
                    if (target === lastTarget) return;
                    lastTarget = target;
                    animation?.cancel();
                    const running = composer.animate(timing.frames.map((progress, index) => ({
                        top: `${previousTop + (target - previousTop) * progress}px`,
                        offset: index / (timing.frames.length - 1),
                    })), { duration: timing.duration, easing: timing.easing, fill: 'forwards' });
                    animation = running;
                    // resize 或桥接延迟不能延长系统动画，也不能重启动画。
                    running.currentTime = elapsed;
                    // 保留终帧到系统 didHide，避免工具栏与主键盘分段恢复时提前回到中间布局。
                    running.finished.catch(() => {});
                };
                const state = { finish };
                window.__codexKeyboardDismissal = state;
                composer.style.top = `${previousTop}px`;
                composer.style.bottom = 'auto';
                window.addEventListener('resize', synchronize);
                window.visualViewport?.addEventListener('resize', synchronize);
                frame = requestAnimationFrame(synchronize);
                timeout = setTimeout(finish, Math.max(0, timing.startedAt + timing.duration - Date.now()) + 500);
                if (timing.duration === 0) finish();
            }
            if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input?.isContentEditable) input.blur();
        })(\(payload));
        """, completionHandler: nil)
    }

    // CASpringAnimation 的单位阶跃响应；包含欠阻尼、临界阻尼和过阻尼，不硬编码系统常数。
    private static func progress(at time: Double, spring: CASpringAnimation) -> Double {
        let omega = sqrt(Double(spring.stiffness / spring.mass))
        let beta = Double(spring.damping / (2 * spring.mass))
        let velocity = Double(spring.initialVelocity)
        let difference = beta * beta - omega * omega
        if abs(difference) < 0.0001 {
            return 1 - exp(-beta * time) * (1 + (beta - velocity) * time)
        }
        if difference < 0 {
            let frequency = sqrt(-difference)
            return 1 - exp(-beta * time) * (cos(frequency * time) + (beta - velocity) / frequency * sin(frequency * time))
        }
        let root = sqrt(difference)
        let r1 = -beta + root, r2 = -beta - root
        let c1 = (velocity + r2) / (r1 - r2)
        return 1 + c1 * exp(r1 * time) + (-1 - c1) * exp(r2 * time)
    }

    @objc private func finish() {
        dismissing = false
        webView?.evaluateJavaScript("window.__codexKeyboardDismissal?.finish()", completionHandler: nil)
    }
}
