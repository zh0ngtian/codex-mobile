import UIKit
import WebKit

/// 外部网页使用独立 WKWebView，避免获得 Codex Mobile 主页面注册的脚本桥能力。
final class CodexMobileInAppBrowserViewController: UIViewController {
    private let initialURL: URL
    private var titleObservation: NSKeyValueObservation?
    private var progressObservation: NSKeyValueObservation?
    private var desktopMode = false
    private var fullscreen = false

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .automatic
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let progressView: UIProgressView = {
        let view = UIProgressView(progressViewStyle: .bar)
        view.progressTintColor = .systemBlue
        view.trackTintColor = .clear
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private lazy var fullscreenMenuButton: UIButton = {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: "ellipsis"), for: .normal)
        button.backgroundColor = .secondarySystemBackground
        button.tintColor = .label
        button.layer.cornerRadius = 22
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.14
        button.layer.shadowRadius = 8
        button.layer.shadowOffset = CGSize(width: 0, height: 3)
        button.showsMenuAsPrimaryAction = true
        button.accessibilityLabel = "网页操作"
        button.translatesAutoresizingMaskIntoConstraints = false
        button.isHidden = true
        return button
    }()

    init(url: URL) {
        initialURL = url
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        edgesForExtendedLayout = []
        configureNavigationBar()
        configureWebView()
        observeWebView()
        webView.load(URLRequest(url: initialURL))
    }

    deinit {
        titleObservation?.invalidate()
        progressObservation?.invalidate()
    }

    static func present(url: URL) {
        guard let presenter = topViewController() else { return }
        if let browser = presenter as? CodexMobileInAppBrowserViewController {
            browser.webView.load(URLRequest(url: url))
            return
        }
        guard !presentationInFlight else { return }
        presentationInFlight = true
        let browser = CodexMobileInAppBrowserViewController(url: url)
        let navigation = UINavigationController(rootViewController: browser)
        navigation.modalPresentationStyle = .fullScreen
        presenter.present(navigation, animated: true) {
            presentationInFlight = false
        }
    }

    private static var presentationInFlight = false

    private static func topViewController(
        base: UIViewController? = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow })?.rootViewController
    ) -> UIViewController? {
        if let navigation = base as? UINavigationController {
            return topViewController(base: navigation.visibleViewController)
        }
        if let tab = base as? UITabBarController,
           let selected = tab.selectedViewController {
            return topViewController(base: selected)
        }
        if let presented = base?.presentedViewController {
            return topViewController(base: presented)
        }
        return base
    }

    private func configureNavigationBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = .systemBackground
        appearance.shadowColor = .clear
        navigationController?.navigationBar.standardAppearance = appearance
        navigationController?.navigationBar.scrollEdgeAppearance = appearance
        navigationController?.navigationBar.compactAppearance = appearance

        navigationItem.leftBarButtonItem = UIBarButtonItem(
            image: UIImage(systemName: "xmark"),
            style: .plain,
            target: self,
            action: #selector(closeBrowser)
        )
        navigationItem.leftBarButtonItem?.accessibilityLabel = "关闭网页"
        updateMenus()
        title = fallbackTitle(for: initialURL)
    }

    private func configureWebView() {
        view.addSubview(webView)
        view.addSubview(progressView)
        view.addSubview(fullscreenMenuButton)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.topAnchor.constraint(equalTo: view.topAnchor),
            fullscreenMenuButton.widthAnchor.constraint(equalToConstant: 44),
            fullscreenMenuButton.heightAnchor.constraint(equalToConstant: 44),
            fullscreenMenuButton.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 8
            ),
            fullscreenMenuButton.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -8
            ),
        ])
    }

    private func observeWebView() {
        titleObservation = webView.observe(\.title, options: [.initial, .new]) {
            [weak self] webView, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                let pageTitle = webView.title?.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                self.title = pageTitle?.isEmpty == false
                    ? pageTitle
                    : self.fallbackTitle(for: webView.url ?? self.initialURL)
            }
        }
        progressObservation = webView.observe(
            \.estimatedProgress,
            options: [.initial, .new]
        ) { [weak self] webView, _ in
            DispatchQueue.main.async {
                self?.progressView.progress = Float(webView.estimatedProgress)
                self?.progressView.isHidden = webView.estimatedProgress >= 1
            }
        }
    }

    private func updateMenus() {
        let menu = makeMenu()
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            image: UIImage(systemName: "ellipsis"),
            menu: menu
        )
        navigationItem.rightBarButtonItem?.accessibilityLabel = "网页操作"
        fullscreenMenuButton.menu = menu
    }

    private func makeMenu() -> UIMenu {
        let external = UIAction(
            title: "在外部浏览器中打开",
            image: UIImage(systemName: "arrow.up.forward.app")
        ) { [weak self] _ in
            self?.openInExternalBrowser()
        }
        let reload = UIAction(
            title: "重新加载",
            image: UIImage(systemName: "arrow.clockwise")
        ) { [weak self] _ in
            self?.webView.reload()
        }
        let desktop = UIAction(
            title: desktopMode ? "手机版网页" : "桌面版网页",
            image: UIImage(systemName: desktopMode ? "iphone" : "desktopcomputer")
        ) { [weak self] _ in
            self?.toggleDesktopMode()
        }
        let fullscreenAction = UIAction(
            title: fullscreen ? "退出全屏" : "全屏打开",
            image: UIImage(
                systemName: fullscreen
                    ? "arrow.down.right.and.arrow.up.left"
                    : "arrow.up.left.and.arrow.down.right"
            )
        ) { [weak self] _ in
            self?.setFullscreen(!(self?.fullscreen ?? false))
        }
        return UIMenu(children: [external, reload, desktop, fullscreenAction])
    }

    private func fallbackTitle(for url: URL) -> String {
        url.host?.isEmpty == false ? url.host! : "网页"
    }

    @objc private func closeBrowser() {
        dismiss(animated: true)
    }

    private func openInExternalBrowser() {
        let url = webView.url ?? initialURL
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func toggleDesktopMode() {
        desktopMode.toggle()
        if desktopMode {
            webView.configuration.defaultWebpagePreferences.preferredContentMode = .desktop
        } else {
            webView.configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        }
        updateMenus()
        webView.reload()
    }

    private func setFullscreen(_ enabled: Bool) {
        fullscreen = enabled
        navigationController?.setNavigationBarHidden(enabled, animated: true)
        fullscreenMenuButton.isHidden = !enabled
        updateMenus()
        setNeedsStatusBarAppearanceUpdate()
    }
}

extension CodexMobileInAppBrowserViewController: WKNavigationDelegate, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        if ["http", "https", "file", "about"].contains(scheme) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}
