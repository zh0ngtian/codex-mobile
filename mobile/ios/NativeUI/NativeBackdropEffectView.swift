import UIKit

/// 首轮非零布局完成后跨一个主线程轮次安装轻模糊，确保 animator 接入真实 backdrop。
final class NativeBackdropEffectView: UIVisualEffectView {
    private var blurAnimator: UIViewPropertyAnimator?
    private var completionDisplayLink: CADisplayLink?
    private var renderedFrameCount = 0
    private var pendingWorkItem: DispatchWorkItem?
    private var generation = 0
    private var needsBlurUpdate = true
    private let intensity: CGFloat

    init(intensity: CGFloat = 0.2) {
        self.intensity = intensity
        super.init(effect: nil)
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: NativeBackdropEffectView, _: UITraitCollection) in
            view.updateBlur()
        }
        NotificationCenter.default.addObserver(self, selector: #selector(transparencyChanged), name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { stopBlur() }
        else { updateBlur() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard needsBlurUpdate, pendingWorkItem == nil, window != nil, bounds.width > 0, bounds.height > 0 else { return }
        let requestedGeneration = generation
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.generation == requestedGeneration else { return }
            self.pendingWorkItem = nil
            guard self.window != nil, self.bounds.width > 0, self.bounds.height > 0, self.needsBlurUpdate else { return }
            self.installBlur()
        }
        pendingWorkItem = work
        DispatchQueue.main.async(execute: work)
    }

    @objc private func transparencyChanged() { updateBlur() }

    private func updateBlur() {
        stopBlur()
        guard window != nil else { return }
        needsBlurUpdate = true
        setNeedsLayout()
    }

    private func installBlur() {
        needsBlurUpdate = false
        if UIAccessibility.isReduceTransparencyEnabled {
            backgroundColor = .systemBackground
            return
        }
        let style: UIBlurEffect.Style = traitCollection.userInterfaceStyle == .dark ? .dark : .light
        let animator = UIViewPropertyAnimator(duration: 1, curve: .linear) { [weak self] in
            self?.effect = UIBlurEffect(style: style)
        }
        animator.pausesOnCompletion = true
        blurAnimator = animator
        animator.startAnimation()
        animator.pauseAnimation()
        animator.fractionComplete = intensity
        renderedFrameCount = 0
        let link = CADisplayLink(target: self, selector: #selector(finishAfterRenderedFrames(_:)))
        completionDisplayLink = link
        link.add(to: .main, forMode: .common)
    }

    @objc private func finishAfterRenderedFrames(_ link: CADisplayLink) {
        guard link === completionDisplayLink else { link.invalidate(); return }
        renderedFrameCount += 1
        guard renderedFrameCount >= 2 else { return }
        link.invalidate()
        completionDisplayLink = nil
        if let animator = blurAnimator, animator.state == .active {
            animator.stopAnimation(false)
            animator.finishAnimation(at: .current)
        }
        blurAnimator = nil
    }

    func stopBlur() {
        generation &+= 1
        pendingWorkItem?.cancel()
        pendingWorkItem = nil
        needsBlurUpdate = false
        completionDisplayLink?.invalidate()
        completionDisplayLink = nil
        renderedFrameCount = 0
        if let animator = blurAnimator, animator.state == .active { animator.stopAnimation(true) }
        blurAnimator = nil
        effect = nil
        backgroundColor = .clear
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}
