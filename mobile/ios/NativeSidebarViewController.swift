import UIKit

/// 边栏只投影 React 快照；关闭、搜索与管理仍交回同一个业务状态源。
final class NativeSidebarViewController: UIViewController, UITableViewDelegate, UITextFieldDelegate, UIGestureRecognizerDelegate {
    var onAction: ((NativeSidebarAction) -> Void)?
    private let state = NativeSidebarState()
    private let drawer = UIView()
    private let scrim = UIButton(type: .custom)
    private let table = UITableView(frame: .zero, style: .plain)
    private let searchContainer = UIView()
    private let searchField = UISearchTextField()
    private let titleLabel = UILabel()
    private let compactSpacer = UIView()
    private let controls = UIStackView()
    private let searchSpinner = UIActivityIndicatorView(style: .medium)
    private var searchIcon: UIView?
    private var editingSearch = false
    private let subtitleLabel = UILabel()
    private let closeButton = UIButton(type: .system)
    private let refreshButton = UIButton(type: .system)
    private let devicesButton = UIButton(type: .system)
    private let backendButton = UIButton(type: .system)
    private let newChatButton = UIButton(type: .system)
    private let statusStack = UIStackView()
    private let statusLabel = UILabel()
    private let statusSpinner = UIActivityIndicatorView(style: .medium)
    private let retryButton = UIButton(type: .system)
    private let refreshControl = UIRefreshControl()
    private var searchHeight: NSLayoutConstraint!
    private var backendHeight: NSLayoutConstraint!
    private var updatingQuery = false
    private var rows: [String: NativeSidebarRow] = [:]
    private var sections: [String: NativeSidebarSection] = [:]
    private var source: UITableViewDiffableDataSource<Section, Item>!
    private var renderedAppearance = ""
    private var renderedErrorNotice: String?
    private enum Section: Hashable { case project(String), notice }
    private enum Item: Hashable { case thread(String), status(String), error }
    private var strings: NativeSidebarStrings { NativeSidebarStrings(snapshot: state.snapshot) }
    var isSidebarVisible: Bool { state.snapshot?.visible ?? false }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.accessibilityIdentifier = "codex.native.sidebar"
        view.isHidden = !isSidebarVisible
        view.accessibilityViewIsModal = isSidebarVisible
        buildLayout()
        buildTable()
        let dismissPan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
        dismissPan.delegate = self
        drawer.addGestureRecognizer(dismissPan)
        if let snapshot = state.snapshot { render(snapshot, resetPosition: true) }
    }

    func receive(_ snapshot: NativeSidebarSnapshot) {
        let contextChanged = state.snapshot?.contextId != snapshot.contextId
        let reopened = !isSidebarVisible && snapshot.visible
        let composing = isViewLoaded && searchField.markedTextRange != nil
        guard state.apply(snapshot, hasMarkedText: composing) else { return }
        guard isViewLoaded else { return }
        if contextChanged {
            searchField.unmarkText()
            view.endEditing(true)
            if presentedViewController != nil { dismiss(animated: false) }
        }
        view.isHidden = !snapshot.visible
        view.accessibilityViewIsModal = snapshot.visible
        guard snapshot.visible else { finishHiding(); return }
        render(snapshot, resetPosition: contextChanged || reopened)
        if contextChanged || reopened {
            UIAccessibility.post(notification: .screenChanged, argument: titleLabel.isHidden ? closeButton : titleLabel)
        }
    }

    @discardableResult
    func hide(contextId: String) -> Bool {
        guard state.hide(contextId: contextId) else { return false }
        if isViewLoaded {
            view.isHidden = true
            view.accessibilityViewIsModal = false
            finishHiding()
        }
        return true
    }

    override func accessibilityPerformEscape() -> Bool {
        guard isSidebarVisible else { return false }
        requestClose()
        return true
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        guard isViewLoaded, let snapshot = state.snapshot else { return }
        let appearance = "\(traitCollection.preferredContentSizeCategory.rawValue):\(traitCollection.userInterfaceStyle.rawValue):\(snapshot.fontSize)"
        guard appearance != renderedAppearance else { return }
        render(snapshot, resetPosition: false)
    }

    private func buildLayout() {
        scrim.translatesAutoresizingMaskIntoConstraints = false
        scrim.backgroundColor = UIColor.black.withAlphaComponent(0.28)
        scrim.accessibilityIdentifier = "codex.native.sidebar.scrim"
        scrim.addAction(UIAction { [weak self] _ in self?.requestClose() }, for: .touchUpInside)
        drawer.translatesAutoresizingMaskIntoConstraints = false
        drawer.backgroundColor = .systemBackground
        view.addSubview(scrim)
        view.addSubview(drawer)
        let preferredWidth = drawer.widthAnchor.constraint(equalTo: view.widthAnchor, constant: -44)
        preferredWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            scrim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrim.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrim.topAnchor.constraint(equalTo: view.topAnchor),
            scrim.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            drawer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            drawer.topAnchor.constraint(equalTo: view.topAnchor),
            drawer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            drawer.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            drawer.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -44),
            preferredWidth
        ])

        titleLabel.text = "Codex Mobile"
        titleLabel.numberOfLines = 2
        titleLabel.textColor = .label
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.accessibilityTraits = .header
        titleLabel.accessibilityIdentifier = "codex.native.sidebar.title"
        subtitleLabel.numberOfLines = 2
        subtitleLabel.textColor = NativeConversationAppearance.secondaryText
        subtitleLabel.adjustsFontForContentSizeCategory = true
        subtitleLabel.accessibilityIdentifier = "codex.native.sidebar.subtitle"
        configureIcon(closeButton, symbol: "xmark", identifier: "codex.native.sidebar.close") { [weak self] in self?.requestClose() }
        configureIcon(refreshButton, symbol: "arrow.clockwise", identifier: "codex.native.sidebar.refresh") { [weak self] in self?.emit("refresh") }
        configureIcon(devicesButton, symbol: "server.rack", identifier: "codex.native.sidebar.devices") { [weak self] in self?.emit("devices") }
        compactSpacer.isHidden = true
        let titleLine = UIStackView(arrangedSubviews: [titleLabel, compactSpacer, closeButton])
        titleLine.alignment = .center
        titleLine.spacing = 8
        titleLine.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        backendButton.accessibilityIdentifier = "codex.native.sidebar.backend"
        backendButton.showsMenuAsPrimaryAction = true
        backendButton.contentHorizontalAlignment = .leading
        backendButton.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        backendHeight = backendButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        backendHeight.isActive = true
        backendButton.setContentCompressionResistancePriority(.required, for: .vertical)
        [backendButton, refreshButton, devicesButton].forEach { controls.addArrangedSubview($0) }
        controls.alignment = .center
        controls.spacing = 8
        let header = UIStackView(arrangedSubviews: [titleLine, subtitleLabel, controls])
        header.axis = .vertical
        header.spacing = 8
        header.translatesAutoresizingMaskIntoConstraints = false
        drawer.addSubview(header)

        // 直接布局原生搜索输入，避免 UISearchBar 内部材质在辅助字号下超出容器。
        searchContainer.translatesAutoresizingMaskIntoConstraints = false
        searchContainer.backgroundColor = .secondarySystemBackground
        searchContainer.layer.cornerRadius = 16
        searchContainer.clipsToBounds = true
        searchField.translatesAutoresizingMaskIntoConstraints = false
        searchField.delegate = self
        searchField.backgroundColor = .clear
        searchField.borderStyle = .none
        searchField.clipsToBounds = true
        searchField.accessibilityIdentifier = "codex.native.sidebar.search"
        searchField.accessibilityTraits.insert(.searchField)
        searchField.adjustsFontForContentSizeCategory = true
        searchField.returnKeyType = .search
        searchField.clearButtonMode = .whileEditing
        searchField.autocapitalizationType = .none
        searchField.autocorrectionType = .no
        let magnifier = UIImageView(image: UIImage(systemName: "magnifyingglass", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)))
        magnifier.frame = CGRect(x: 0, y: 0, width: 28, height: 28)
        magnifier.tintColor = NativeConversationAppearance.secondaryText
        magnifier.contentMode = .center
        searchIcon = magnifier
        searchField.leftView = magnifier
        searchField.leftViewMode = .always
        searchSpinner.frame = CGRect(x: 0, y: 0, width: 28, height: 28)
        searchField.addAction(UIAction { [weak self] _ in self?.searchChanged() }, for: .editingChanged)
        drawer.addSubview(searchContainer)
        searchContainer.addSubview(searchField)
        searchHeight = searchField.heightAnchor.constraint(equalToConstant: 44)
        NSLayoutConstraint.activate([
            searchHeight,
            searchField.topAnchor.constraint(equalTo: searchContainer.topAnchor, constant: 8),
            searchField.bottomAnchor.constraint(equalTo: searchContainer.bottomAnchor, constant: -8),
            searchField.leadingAnchor.constraint(equalTo: searchContainer.leadingAnchor, constant: 12),
            searchField.trailingAnchor.constraint(equalTo: searchContainer.trailingAnchor, constant: -12)
        ])

        statusLabel.numberOfLines = 0
        statusLabel.textColor = NativeConversationAppearance.secondaryText
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.accessibilityIdentifier = "codex.native.sidebar.status"
        statusSpinner.hidesWhenStopped = true
        retryButton.accessibilityIdentifier = "codex.native.sidebar.retry"
        retryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        retryButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        retryButton.addAction(UIAction { [weak self] _ in self?.emit("refresh") }, for: .touchUpInside)
        let statusLine = UIStackView(arrangedSubviews: [statusSpinner, statusLabel])
        statusLine.alignment = .center
        statusLine.spacing = 8
        statusStack.axis = .vertical
        statusStack.spacing = 4
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusStack.addArrangedSubview(statusLine)
        statusStack.addArrangedSubview(retryButton)
        drawer.addSubview(statusStack)

        newChatButton.translatesAutoresizingMaskIntoConstraints = false
        newChatButton.accessibilityIdentifier = "codex.native.sidebar.new"
        newChatButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
        newChatButton.addAction(UIAction { [weak self] _ in self?.view.endEditing(true); self?.emit("new") }, for: .touchUpInside)
        drawer.addSubview(newChatButton)
        table.translatesAutoresizingMaskIntoConstraints = false
        drawer.addSubview(table)
        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: drawer.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            header.trailingAnchor.constraint(equalTo: drawer.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            header.topAnchor.constraint(equalTo: drawer.safeAreaLayoutGuide.topAnchor, constant: 4),
            searchContainer.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            searchContainer.leadingAnchor.constraint(equalTo: drawer.leadingAnchor, constant: 12),
            searchContainer.trailingAnchor.constraint(equalTo: drawer.trailingAnchor, constant: -12),
            statusStack.topAnchor.constraint(equalTo: searchContainer.bottomAnchor, constant: 4),
            statusStack.leadingAnchor.constraint(equalTo: drawer.leadingAnchor, constant: 16),
            statusStack.trailingAnchor.constraint(equalTo: drawer.trailingAnchor, constant: -16),
            table.topAnchor.constraint(equalTo: statusStack.bottomAnchor, constant: 4),
            table.leadingAnchor.constraint(equalTo: drawer.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: drawer.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: newChatButton.topAnchor, constant: -8),
            newChatButton.leadingAnchor.constraint(equalTo: drawer.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            newChatButton.trailingAnchor.constraint(equalTo: drawer.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            newChatButton.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8)
        ])
    }

    private func buildTable() {
        table.accessibilityIdentifier = "codex.native.sidebar.list"
        table.backgroundColor = .systemBackground
        table.separatorStyle = .none
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 88
        table.sectionHeaderHeight = UITableView.automaticDimension
        table.estimatedSectionHeaderHeight = 48
        table.sectionHeaderTopPadding = 0
        table.keyboardDismissMode = .interactive
        table.delegate = self
        table.register(NativeSidebarCell.self, forCellReuseIdentifier: "thread")
        table.register(NativeSidebarStatusCell.self, forCellReuseIdentifier: "status")
        table.register(NativeSidebarSectionHeader.self, forHeaderFooterViewReuseIdentifier: "project")
        refreshControl.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            if !self.emit("refresh") { self.refreshControl.endRefreshing() }
        }, for: .valueChanged)
        table.refreshControl = refreshControl
        source = UITableViewDiffableDataSource<Section, Item>(tableView: table) { [weak self] table, indexPath, item in
            guard let self, let snapshot = self.state.snapshot else { return nil }
            switch item {
            case .thread(let id):
                guard let row = self.rows[id], let cell = table.dequeueReusableCell(withIdentifier: "thread", for: indexPath) as? NativeSidebarCell else { return nil }
                cell.configure(row, fontSize: CGFloat(snapshot.fontSize), traits: self.traitCollection, strings: self.strings, enabled: snapshot.allowsRowActions && !row.opening)
                cell.accessibilityCustomActions = self.rowActions(row).filter { self.allows($0.type, row: row) }.map { action in
                    UIAccessibilityCustomAction(name: action.title) { [weak self] _ in self?.perform(action.type, rowID: id) ?? false }
                }
                return cell
            case .status(let id):
                guard let section = self.sections[id], let cell = table.dequeueReusableCell(withIdentifier: "status", for: indexPath) as? NativeSidebarStatusCell else { return nil }
                cell.configure(section, fontSize: CGFloat(snapshot.fontSize), traits: self.traitCollection, strings: self.strings)
                cell.onSelect = { [weak self] in self?.emit(section.error ? "project-retry" : "project-more", id: section.id) }
                return cell
            case .error:
                guard let cell = table.dequeueReusableCell(withIdentifier: "status", for: indexPath) as? NativeSidebarStatusCell else { return nil }
                cell.configureError(snapshot, traits: self.traitCollection, strings: self.strings)
                cell.onSelect = { [weak self] in self?.emit("refresh") }
                return cell
            }
        }
    }

    private func render(_ snapshot: NativeSidebarSnapshot, resetPosition: Bool) {
        let appearance = "\(traitCollection.preferredContentSizeCategory.rawValue):\(traitCollection.userInterfaceStyle.rawValue):\(snapshot.fontSize)"
        renderedAppearance = appearance
        let size = CGFloat(snapshot.fontSize)
        let bodyFont = NativeConversationAppearance.body(size, traits: traitCollection)
        let detailFont = NativeConversationAppearance.scaled(max(size - 2, 12), style: .footnote, traits: traitCollection)
        titleLabel.font = NativeConversationAppearance.scaled(max(size + 2, 17), style: .headline, traits: traitCollection, weight: .semibold)
        subtitleLabel.font = detailFont
        subtitleLabel.text = snapshot.subtitle
        // 辅助字号优先保留会话列表空间，品牌和设备统计在此时收起。
        let compactHeader = editingSearch || traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        subtitleLabel.isHidden = snapshot.subtitle.isEmpty || compactHeader
        titleLabel.isHidden = compactHeader
        compactSpacer.isHidden = !compactHeader
        controls.isHidden = editingSearch
        searchField.font = bodyFont
        searchHeight.constant = max(44, ceil(bodyFont.lineHeight + 24))
        backendHeight.constant = max(44, ceil(bodyFont.lineHeight + 16))
        searchField.attributedPlaceholder = NSAttributedString(string: strings.text("search"), attributes: [.foregroundColor: NativeConversationAppearance.secondaryText, .font: bodyFont])
        searchField.accessibilityLabel = strings.text("search")
        if searchField.markedTextRange == nil, searchField.text != state.query {
            updatingQuery = true
            searchField.text = state.query
            updatingQuery = false
        }
        closeButton.accessibilityLabel = strings.text("close")
        scrim.accessibilityLabel = strings.text("close")
        refreshButton.accessibilityLabel = strings.text("refresh")
        devicesButton.accessibilityLabel = strings.text("devices")
        refreshButton.isEnabled = !snapshot.refreshing
        updateBackendMenu(snapshot, font: bodyFont)
        var newConfig = UIButton.Configuration.tinted()
        newConfig.title = strings.text("newChat")
        newConfig.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium))
        newConfig.imagePadding = 8
        newConfig.baseForegroundColor = .label
        newConfig.baseBackgroundColor = .secondarySystemBackground
        newConfig.cornerStyle = .medium
        newConfig.titleLineBreakMode = .byWordWrapping
        newConfig.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
        newConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var next = attributes; next.font = bodyFont; return next
        }
        newChatButton.configuration = newConfig
        newChatButton.isEnabled = snapshot.pendingAction != "new"
        updateStatus(snapshot, font: detailFont)
        if !snapshot.refreshing { refreshControl.endRefreshing() }
        refreshControl.accessibilityLabel = strings.text("refresh")
        rows = Dictionary(uniqueKeysWithValues: snapshot.sections.flatMap { $0.rows.map { ($0.id, $0) } })
        sections = Dictionary(uniqueKeysWithValues: snapshot.sections.map { ($0.id, $0) })
        table.allowsSelection = snapshot.allowsRowActions
        var next = NSDiffableDataSourceSnapshot<Section, Item>()
        let errorNotice = editingSearch && snapshot.hasError ? snapshot.error : nil
        let revealErrorNotice = errorNotice != nil && errorNotice != renderedErrorNotice
        renderedErrorNotice = errorNotice
        // 搜索键盘占用高度时，失败与重试作为列表行参与滚动，避免固定区域挤压内容。
        if editingSearch && snapshot.hasError {
            next.appendSections([.notice])
            next.appendItems([.error], toSection: .notice)
        }
        for section in snapshot.sections {
            next.appendSections([.project(section.id)])
            if section.expanded || !state.query.isEmpty || !section.collapsible {
                next.appendItems(section.rows.map { .thread($0.id) }, toSection: .project(section.id))
                if section.loading || section.error || section.more { next.appendItems([.status(section.id)], toSection: .project(section.id)) }
            }
        }
        let existing = Set(source.snapshot().itemIdentifiers)
        let updates = next.itemIdentifiers.filter { existing.contains($0) }
        if !updates.isEmpty { next.reconfigureItems(updates) }
        let offset = table.contentOffset
        source.apply(next, animatingDifferences: false)
        table.backgroundView = next.itemIdentifiers.isEmpty ? emptyView(snapshot, bodyFont: bodyFont, detailFont: detailFont) : nil
        if resetPosition || revealErrorNotice {
            table.setContentOffset(CGPoint(x: 0, y: -table.adjustedContentInset.top), animated: false)
        } else {
            table.layoutIfNeeded()
            let maximum = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
            table.setContentOffset(CGPoint(x: 0, y: min(max(offset.y, -table.adjustedContentInset.top), maximum)), animated: false)
        }
        // Diffable 数据刷新不会主动重建现有 header，明确刷新其文案与字体。
        for (index, id) in next.sectionIdentifiers.enumerated() {
            if case .project(let projectID) = id, let section = sections[projectID],
               let header = table.headerView(forSection: index) as? NativeSidebarSectionHeader {
                configure(header, section: section)
            }
        }
    }

    private func updateBackendMenu(_ snapshot: NativeSidebarSnapshot, font: UIFont) {
        let selected = snapshot.backends.first { $0.id == snapshot.selectedBackendId }
        var config = UIButton.Configuration.plain()
        config.title = selected?.label ?? strings.text("allBackends")
        config.image = UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .medium))
        config.imagePlacement = .trailing
        config.imagePadding = 8
        config.baseForegroundColor = .label
        config.titleLineBreakMode = .byWordWrapping
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var next = attributes; next.font = font; return next
        }
        backendButton.configuration = config
        backendButton.accessibilityLabel = strings.text("selectBackend")
        backendButton.accessibilityValue = selected?.label ?? strings.text("allBackends")
        let choices: [UIMenuElement] = snapshot.backends.map { backend in
            let details = backend.detail.isEmpty ? [backend.loading ? strings.text("loading") : "", backend.approvalCount > 0 ? "\(backend.approvalCount) \(strings.text("approvals"))" : ""].filter { !$0.isEmpty }.joined(separator: " · ") : backend.detail
            return UIAction(title: backend.label, subtitle: details.isEmpty ? nil : details,
                            image: UIImage(systemName: backend.id == "all" ? "square.stack" : (backend.loading ? "arrow.triangle.2.circlepath" : (backend.online ? "desktopcomputer" : "wifi.slash"))),
                            state: snapshot.selectedBackendId == backend.id ? .on : .off) { [weak self] _ in
                self?.emit("backend", id: backend.id)
            }
        }
        backendButton.menu = UIMenu(title: strings.text("selectBackend"), children: choices)
    }

    private func updateStatus(_ snapshot: NativeSidebarSnapshot, font: UIFont) {
        let failed = snapshot.hasError
        let busy = snapshot.searching || snapshot.refreshing || snapshot.loadState == "loading"
        statusStack.isHidden = editingSearch || (!failed && !busy)
        if editingSearch && busy {
            searchSpinner.startAnimating()
            searchField.leftView = searchSpinner
        } else {
            searchSpinner.stopAnimating()
            searchField.leftView = searchIcon
        }
        statusLabel.font = font
        statusLabel.text = editingSearch || (!failed && !busy) ? nil : failed ? (snapshot.error.isEmpty ? strings.text("loadError") : snapshot.error) : (snapshot.searching ? strings.text("searching") : strings.text("loading"))
        retryButton.isHidden = editingSearch || !failed || snapshot.refreshing
        retryButton.setTitle(strings.text("retry"), for: .normal)
        retryButton.titleLabel?.font = font
        retryButton.tintColor = .label
        if busy && !failed && !editingSearch { statusSpinner.startAnimating() } else { statusSpinner.stopAnimating() }
    }

    private func emptyView(_ snapshot: NativeSidebarSnapshot, bodyFont: UIFont, detailFont: UIFont) -> UIView {
        let container = UIScrollView()
        container.alwaysBounceVertical = false
        let heading = UILabel()
        heading.numberOfLines = 0
        heading.textAlignment = .center
        heading.font = bodyFont
        heading.textColor = .label
        heading.adjustsFontForContentSizeCategory = true
        heading.accessibilityIdentifier = "codex.native.sidebar.empty"
        let hint = UILabel()
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.font = detailFont
        hint.textColor = NativeConversationAppearance.secondaryText
        hint.adjustsFontForContentSizeCategory = true
        switch snapshot.emptyState(query: state.query) {
        case .error: heading.text = snapshot.error.isEmpty ? strings.text("loadError") : snapshot.error
        case .searching: heading.text = strings.text("searching")
        case .loading: heading.text = strings.text("loading")
        case .noResults: heading.text = strings.text("noResults"); hint.text = strings.text("noResultsHint")
        case .empty: heading.text = strings.text("empty")
        }
        hint.isHidden = hint.text?.isEmpty ?? true
        let stack = UIStackView(arrangedSubviews: [heading, hint])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.contentLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: container.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: container.frameLayoutGuide.widthAnchor, constant: -48),
            stack.topAnchor.constraint(equalTo: container.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: container.contentLayoutGuide.bottomAnchor, constant: -24)
        ])
        return container
    }

    private func configureIcon(_ button: UIButton, symbol: String, identifier: String, action: @escaping () -> Void) {
        button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18)), for: .normal)
        button.tintColor = .label
        button.accessibilityIdentifier = identifier
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    }

    @discardableResult
    private func emit(_ type: String, id: String? = nil, text: String? = nil) -> Bool {
        guard let action = state.action(type, text: text, id: id) else { return false }
        onAction?(action)
        return true
    }

    private func requestClose() {
        view.endEditing(true)
        updatingQuery = true
        searchField.text = ""
        updatingQuery = false
        emit("close")
    }

    private func finishHiding() {
        view.endEditing(true)
        updatingQuery = true
        searchField.text = ""
        updatingQuery = false
        refreshControl.endRefreshing()
        if presentedViewController != nil { dismiss(animated: false) }
    }

    private func searchChanged() {
        guard !updatingQuery else { return }
        emit("query", text: searchField.text ?? "")
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }

    func textFieldDidBeginEditing(_ textField: UITextField) {
        editingSearch = true
        if let snapshot = state.snapshot { render(snapshot, resetPosition: false) }
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        editingSearch = false
        if let snapshot = state.snapshot, snapshot.visible { render(snapshot, resetPosition: false) }
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: false)
        guard state.snapshot?.allowsRowActions == true,
              case .thread(let id) = source.itemIdentifier(for: indexPath) else { return }
        view.endEditing(true)
        emit("open", id: id)
    }

    func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let ids = source.snapshot().sectionIdentifiers
        guard section < ids.count, case .project(let id) = ids[section], let model = sections[id],
              let header = tableView.dequeueReusableHeaderFooterView(withIdentifier: "project") as? NativeSidebarSectionHeader else { return nil }
        configure(header, section: model)
        return header
    }

    func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        let ids = source.snapshot().sectionIdentifiers
        guard section < ids.count else { return UITableView.automaticDimension }
        return ids[section] == .notice ? .leastNormalMagnitude : UITableView.automaticDimension
    }

    private func configure(_ header: NativeSidebarSectionHeader, section: NativeSidebarSection) {
        guard let snapshot = state.snapshot else { return }
        header.configure(section, searching: !state.query.isEmpty, fontSize: CGFloat(snapshot.fontSize), traits: traitCollection, strings: strings)
        header.onSelect = { [weak self] in self?.emit("project-collapse", id: section.id) }
    }

    func tableView(_ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath, point: CGPoint) -> UIContextMenuConfiguration? {
        guard state.snapshot?.allowsRowActions == true,
              case .thread(let id) = source.itemIdentifier(for: indexPath), rows[id] != nil else { return nil }
        return UIContextMenuConfiguration(identifier: id as NSString, previewProvider: nil) { [weak self] _ in
            guard let self, let row = self.rows[id] else { return nil }
            return UIMenu(children: self.rowActions(row).map { action in
                let enabled = self.allows(action.type, row: row)
                let attributes: UIMenuElement.Attributes = action.type == "archive" ? (enabled ? [.destructive] : [.destructive, .disabled]) : (enabled ? [] : [.disabled])
                return UIAction(title: action.title, image: UIImage(systemName: action.symbol), attributes: attributes) { [weak self] _ in
                    _ = self?.perform(action.type, rowID: id)
                }
            })
        }
    }

    private func rowActions(_ row: NativeSidebarRow) -> [(type: String, title: String, symbol: String)] {
        [("pin", strings.text(row.pinned ? "unpin" : "pin"), row.pinned ? "pin.slash" : "pin"),
         ("refresh-thread", strings.text("refreshThread"), "arrow.clockwise"),
         ("duplicate", strings.text("duplicate"), "plus.square.on.square"),
         ("copy", strings.text("copy"), "doc.on.doc"),
         ("rename", strings.text("rename"), "pencil"),
         ("archive", strings.text("archive"), "archivebox")]
    }

    private func allows(_ type: String, row: NativeSidebarRow) -> Bool {
        guard state.snapshot?.allowsRowActions == true else { return false }
        if row.readOnly && ["duplicate", "rename", "archive"].contains(type) { return false }
        return !(state.snapshot?.pendingKey == row.id && state.snapshot?.pendingAction == type)
    }

    @discardableResult
    private func perform(_ type: String, rowID: String) -> Bool {
        guard isSidebarVisible, let row = rows[rowID], allows(type, row: row) else { return false }
        if type == "rename" { rename(row); return true }
        if type == "copy" {
            guard emit("copy", id: row.id) else { return false }
            UIPasteboard.general.string = row.threadId
            return true
        }
        return emit(type, id: row.id)
    }

    private func rename(_ row: NativeSidebarRow) {
        guard presentedViewController == nil else { return }
        view.endEditing(true)
        let context = state.snapshot?.contextId
        let alert = UIAlertController(title: strings.text("rename"), message: strings.text("renamePrompt"), preferredStyle: .alert)
        alert.addTextField { field in
            field.text = row.title
            field.placeholder = self.strings.text("renamePrompt")
            field.clearButtonMode = .whileEditing
            field.accessibilityIdentifier = "codex.native.sidebar.rename.field"
        }
        alert.addAction(UIAlertAction(title: strings.text("cancel"), style: .cancel))
        alert.addAction(UIAlertAction(title: strings.text("save"), style: .default) { [weak self, weak alert] _ in
            guard let self, self.state.snapshot?.contextId == context,
                  let title = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { return }
            self.emit("rename", id: row.id, text: title)
        })
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        let velocity = pan.velocity(in: drawer)
        return isSidebarVisible && velocity.x < 0 && abs(velocity.x) > abs(velocity.y) * 1.6
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let touched = touch.view else { return true }
        return !touched.isDescendant(of: searchContainer)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        otherGestureRecognizer === table.panGestureRecognizer
    }

    @objc private func panned(_ pan: UIPanGestureRecognizer) {
        guard pan.state == .ended else { return }
        let translation = pan.translation(in: drawer)
        let velocity = pan.velocity(in: drawer)
        let horizontal = abs(translation.x) > abs(translation.y) * 1.6
        let movedEnough = translation.x < -max(56, drawer.bounds.width * 0.22)
        let flicked = translation.x < -24 && velocity.x < -750
        if horizontal && (movedEnough || flicked) { requestClose() }
    }
}

private final class NativeSidebarCell: UITableViewCell {
    private let titleLabel = UILabel()
    private let metadataLabel = UILabel()
    private let snippetLabel = UILabel()
    private let statusLabel = UILabel()
    private let pinIcon = UIImageView(image: UIImage(systemName: "pin.fill"))
    private let opening = UIActivityIndicatorView(style: .medium)

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .systemBackground
        let selected = UIView(); selected.backgroundColor = .secondarySystemBackground
        selectedBackgroundView = selected
        titleLabel.numberOfLines = 2
        titleLabel.textColor = .label
        metadataLabel.numberOfLines = 2
        snippetLabel.numberOfLines = 2
        statusLabel.numberOfLines = 0
        for label in [titleLabel, metadataLabel, snippetLabel, statusLabel] {
            label.adjustsFontForContentSizeCategory = true
            label.setContentCompressionResistancePriority(.required, for: .vertical)
        }
        for label in [metadataLabel, snippetLabel, statusLabel] { label.textColor = NativeConversationAppearance.secondaryText }
        pinIcon.tintColor = NativeConversationAppearance.secondaryText
        pinIcon.contentMode = .scaleAspectFit
        pinIcon.widthAnchor.constraint(equalToConstant: 12).isActive = true
        pinIcon.heightAnchor.constraint(equalToConstant: 16).isActive = true
        opening.hidesWhenStopped = true
        let titleLine = UIStackView(arrangedSubviews: [pinIcon, titleLabel, opening])
        titleLine.alignment = .center
        titleLine.spacing = 8
        let stack = UIStackView(arrangedSubviews: [titleLine, metadataLabel, snippetLabel, statusLabel])
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
            contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
        isAccessibilityElement = true
        accessibilityTraits = .button
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ row: NativeSidebarRow, fontSize: CGFloat, traits: UITraitCollection, strings: NativeSidebarStrings, enabled: Bool) {
        titleLabel.text = row.title
        titleLabel.font = NativeConversationAppearance.body(fontSize, traits: traits, weight: row.unread ? .semibold : .regular)
        let detailFont = NativeConversationAppearance.scaled(max(fontSize - 2, 12), style: .footnote, traits: traits)
        metadataLabel.font = detailFont
        snippetLabel.font = detailFont
        statusLabel.font = detailFont
        metadataLabel.text = [row.source, row.time].filter { !$0.isEmpty }.joined(separator: " · ")
        snippetLabel.text = row.snippet
        let statuses = [row.running ? strings.text("running") : "", row.unread ? strings.text("unread") : "", row.opening ? strings.text("loading") : ""].filter { !$0.isEmpty }
        statusLabel.text = statuses.joined(separator: " · ")
        metadataLabel.isHidden = metadataLabel.text?.isEmpty ?? true
        snippetLabel.isHidden = row.snippet.isEmpty
        statusLabel.isHidden = statuses.isEmpty
        pinIcon.isHidden = !row.pinned
        if row.opening { opening.startAnimating() } else { opening.stopAnimating() }
        accessibilityIdentifier = "codex.native.sidebar.thread.\(row.id)"
        accessibilityLabel = [row.title, metadataLabel.text ?? "", row.snippet].filter { !$0.isEmpty }.joined(separator: ", ")
        accessibilityValue = ([row.pinned ? strings.text("pin") : ""] + statuses).filter { !$0.isEmpty }.joined(separator: ", ")
        isUserInteractionEnabled = enabled
        selectionStyle = enabled ? .default : .none
        accessibilityTraits = enabled ? [.button] : [.button, .notEnabled]
    }
}

private final class NativeSidebarSectionHeader: UITableViewHeaderFooterView {
    var onSelect: (() -> Void)?
    private let button = UIButton(type: .system)
    override init(reuseIdentifier: String?) {
        super.init(reuseIdentifier: reuseIdentifier)
        contentView.backgroundColor = .systemBackground
        button.translatesAutoresizingMaskIntoConstraints = false
        button.contentHorizontalAlignment = .leading
        button.addAction(UIAction { [weak self] _ in self?.onSelect?() }, for: .touchUpInside)
        contentView.addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            button.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            button.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            button.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configure(_ section: NativeSidebarSection, searching: Bool, fontSize: CGFloat, traits: UITraitCollection, strings: NativeSidebarStrings) {
        let font = NativeConversationAppearance.scaled(max(fontSize - 2, 12), style: .subheadline, traits: traits, weight: .semibold)
        var config = UIButton.Configuration.plain()
        config.title = section.title
        config.titleLineBreakMode = .byWordWrapping
        config.baseForegroundColor = NativeConversationAppearance.secondaryText
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4)
        if section.collapsible {
            config.image = UIImage(systemName: section.expanded || searching ? "chevron.down" : "chevron.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold))
            config.imagePlacement = .trailing
            config.imagePadding = 8
        }
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var next = attributes; next.font = font; return next
        }
        button.configuration = config
        button.isUserInteractionEnabled = section.collapsible
        button.isEnabled = !section.collapsible || (!searching && !section.loading)
        button.accessibilityIdentifier = "codex.native.sidebar.project.\(section.id)"
        button.accessibilityLabel = section.title
        button.accessibilityValue = section.collapsible ? strings.text(section.expanded || searching ? "expanded" : "collapsed") : nil
        button.accessibilityTraits = section.collapsible ? (button.isEnabled ? [.button, .header] : [.button, .header, .notEnabled]) : [.header]
    }
}

private final class NativeSidebarStatusCell: UITableViewCell {
    var onSelect: (() -> Void)?
    private let label = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let button = UIButton(type: .system)
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .systemBackground
        label.numberOfLines = 0
        label.textColor = NativeConversationAppearance.secondaryText
        label.adjustsFontForContentSizeCategory = true
        spinner.hidesWhenStopped = true
        let status = UIStackView(arrangedSubviews: [spinner, label]); status.alignment = .center; status.spacing = 8
        button.tintColor = .label
        button.contentHorizontalAlignment = .leading
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.addAction(UIAction { [weak self] _ in self?.onSelect?() }, for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [status, button])
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8)
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configureError(_ snapshot: NativeSidebarSnapshot, traits: UITraitCollection, strings: NativeSidebarStrings) {
        let font = NativeConversationAppearance.scaled(max(CGFloat(snapshot.fontSize) - 2, 12), style: .footnote, traits: traits)
        label.font = font
        button.titleLabel?.font = font
        label.text = snapshot.error.isEmpty ? strings.text("loadError") : snapshot.error
        label.accessibilityIdentifier = "codex.native.sidebar.error"
        label.isHidden = false
        button.isHidden = false
        button.isEnabled = !snapshot.refreshing
        button.setTitle(strings.text("retry"), for: .normal)
        button.accessibilityIdentifier = "codex.native.sidebar.retry"
        spinner.stopAnimating()
    }

    func configure(_ section: NativeSidebarSection, fontSize: CGFloat, traits: UITraitCollection, strings: NativeSidebarStrings) {
        label.accessibilityIdentifier = nil
        button.isEnabled = !section.loading
        let font = NativeConversationAppearance.scaled(max(fontSize - 2, 12), style: .footnote, traits: traits)
        label.font = font
        button.titleLabel?.font = font
        label.text = section.error ? strings.text("loadError") : strings.text("loading")
        label.isHidden = !section.error && !section.loading
        button.isHidden = section.loading || (!section.more && !section.error)
        button.setTitle(strings.text(section.error ? "retry" : "more"), for: .normal)
        button.accessibilityIdentifier = "codex.native.sidebar.\(section.error ? "retry" : "more").\(section.id)"
        if section.loading { spinner.startAnimating() } else { spinner.stopAnimating() }
    }
}
