import UIKit

final class NativeConversationViewController: UIViewController, UITextViewDelegate, UITableViewDelegate {
    var onAction: ((NativeConversationAction) -> Void)?
    private let state = NativeConversationState()
    private let timeline = UITableView(frame: .zero, style: .plain)
    private let composer = UITextView()
    private let sendButton = UIButton(type: .system)
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let statusLabel = UILabel()
    private let statusButton = UIButton(type: .system)
    private let menuButton = UIButton(type: .system)
    private var backButton: UIButton?
    private let settingsButton = UIButton(type: .system)
    private let projectButton = UIButton(type: .system)
    private let backendButton = UIButton(type: .system)
    private let attachmentButton = UIButton(type: .system)
    private let latestButton = UIButton(type: .system)
    private let olderButton = UIButton(type: .system)
    private let accessories = UIStackView()
    private var composerHeight: NSLayoutConstraint!
    private var source: UITableViewDiffableDataSource<Int, String>!
    private var rows: [String: NativeConversationRow] = [:]
    private var markdownCache: [String: (String, Double, NSAttributedString)] = [:]
    private var applyingSnapshot = false
    private var pendingBottomScroll = false
    private var updatingDraft = false
    private var lastAccessories = ""
    private var renderedFontSize: Double?
    private var renderedEditingAllowed: Bool?
    private var renderedLocale: String?
    private var strings: NativeConversationStrings { NativeConversationStrings(locale: state.snapshot?.locale ?? "zh-CN") }
    var isConversationVisible: Bool { state.snapshot?.visible ?? false }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.accessibilityIdentifier = "codex.native.conversation"
        view.isHidden = !(state.snapshot?.visible ?? false)
        buildTimeline()
        buildHeader()
        buildComposer()
        let backGesture = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeBack(_:)))
        backGesture.edges = .left
        view.addGestureRecognizer(backGesture)
        if let snapshot = state.snapshot { render(snapshot, contextChanged: true) }
    }

    func receive(_ snapshot: NativeConversationSnapshot) {
        let contextChanged = state.snapshot?.contextId != snapshot.contextId
        if contextChanged && isViewLoaded {
            composer.unmarkText()
            composer.resignFirstResponder()
            if presentedViewController != nil { dismiss(animated: false) }
        }
        _ = state.apply(snapshot, hasMarkedText: isViewLoaded && composer.markedTextRange != nil)
        guard isViewLoaded else { return }
        view.isHidden = !snapshot.visible
        view.accessibilityViewIsModal = snapshot.visible
        if !snapshot.visible {
            composer.resignFirstResponder()
            if presentedViewController != nil { dismiss(animated: false) }
            return
        }
        render(snapshot, contextChanged: contextChanged)
    }

    @discardableResult
    func hide(contextId: String) -> Bool {
        guard state.hide(contextId: contextId) else { return false }
        if isViewLoaded {
            composer.resignFirstResponder()
            view.isHidden = true
            view.accessibilityViewIsModal = false
            if presentedViewController != nil { dismiss(animated: false) }
        }
        return true
    }

    private func buildHeader() {
        let back = button("", symbol: "chevron.left", identifier: "codex.native.back") { [weak self] in self?.back() }
        backButton = back
        back.accessibilityLabel = strings.text(.back)
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.numberOfLines = 1
        subtitleLabel.font = .preferredFont(forTextStyle: .caption1)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.numberOfLines = 1
        let titles = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel])
        titles.axis = .vertical
        titles.spacing = 2
        menuButton.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        menuButton.accessibilityLabel = strings.text(.menu)
        menuButton.accessibilityIdentifier = "codex.native.menu"
        menuButton.showsMenuAsPrimaryAction = true
        menuButton.widthAnchor.constraint(equalToConstant: 44).isActive = true
        let header = UIStackView(arrangedSubviews: [back, titles, menuButton])
        header.alignment = .center
        header.spacing = 8
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        statusLabel.font = .preferredFont(forTextStyle: .caption1)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 2
        statusButton.setTitle(strings.text(.retry), for: .normal)
        statusButton.addAction(UIAction { [weak self] _ in self?.emit("retry") }, for: .touchUpInside)
        let status = UIStackView(arrangedSubviews: [statusLabel, statusButton])
        status.alignment = .center
        status.spacing = 8
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            header.heightAnchor.constraint(equalToConstant: 52),
            status.topAnchor.constraint(equalTo: header.bottomAnchor),
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            timeline.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 6)
        ])
    }

    private func buildTimeline() {
        timeline.translatesAutoresizingMaskIntoConstraints = false
        timeline.accessibilityIdentifier = "codex.native.timeline"
        timeline.backgroundColor = .systemBackground
        timeline.separatorStyle = .none
        timeline.rowHeight = UITableView.automaticDimension
        timeline.estimatedRowHeight = 160
        timeline.keyboardDismissMode = .interactive
        timeline.delegate = self
        timeline.register(NativeConversationCell.self, forCellReuseIdentifier: "message")
        timeline.contentInset.top = 8
        timeline.contentInset.bottom = 8
        view.addSubview(timeline)
        source = UITableViewDiffableDataSource<Int, String>(tableView: timeline) { [weak self] table, index, id in
            guard let self, let row = self.rows[id], let cell = table.dequeueReusableCell(withIdentifier: "message", for: index) as? NativeConversationCell else { return nil }
            cell.configure(row, text: self.formatted(row), editable: self.state.snapshot?.allowsEditingMessages == true, strings: self.strings)
            cell.onDetail = { [weak self] in self?.showDetail(row) }
            cell.onWeb = { [weak self] in self?.emit("web", id: row.id) }
            cell.onEdit = { [weak self] in self?.emit("edit", id: row.id) }
            return cell
        }
        olderButton.accessibilityIdentifier = "codex.native.load-older"
        olderButton.setTitle(strings.text(.older), for: .normal)
        olderButton.addAction(UIAction { [weak self] _ in self?.emit("loadOlder") }, for: .touchUpInside)
        olderButton.frame = CGRect(x: 0, y: 0, width: 320, height: 44)
        timeline.tableHeaderView = olderButton
        latestButton.accessibilityIdentifier = "codex.native.latest"
        latestButton.setTitle(strings.text(.latest), for: .normal)
        latestButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        latestButton.backgroundColor = .secondarySystemBackground
        latestButton.layer.cornerRadius = 16
        var latestConfiguration = UIButton.Configuration.plain()
        latestConfiguration.title = strings.text(.latest)
        latestConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
        latestButton.configuration = latestConfiguration
        latestButton.translatesAutoresizingMaskIntoConstraints = false
        latestButton.isHidden = true
        latestButton.addAction(UIAction { [weak self] _ in self?.scrollToBottom(animated: true) }, for: .touchUpInside)
        view.addSubview(latestButton)
        NSLayoutConstraint.activate([
            timeline.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            timeline.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            latestButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            latestButton.bottomAnchor.constraint(equalTo: timeline.bottomAnchor, constant: -12)
        ])
    }

    private func buildComposer() {
        let panel = UIStackView()
        panel.axis = .vertical
        panel.spacing = 7
        panel.layoutMargins = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        panel.isLayoutMarginsRelativeArrangement = true
        panel.backgroundColor = .systemBackground
        panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel)
        accessories.axis = .vertical
        accessories.spacing = 5
        accessories.isHidden = true
        panel.addArrangedSubview(accessories)
        settingsButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        settingsButton.showsMenuAsPrimaryAction = true
        projectButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        projectButton.showsMenuAsPrimaryAction = true
        backendButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        backendButton.showsMenuAsPrimaryAction = true
        let choices = UIStackView(arrangedSubviews: [settingsButton, projectButton, backendButton])
        choices.spacing = 12
        choices.alignment = .leading
        panel.addArrangedSubview(choices)
        attachmentButton.setImage(UIImage(systemName: "plus.circle"), for: .normal)
        attachmentButton.accessibilityLabel = strings.text(.attachments)
        attachmentButton.showsMenuAsPrimaryAction = true
        attachmentButton.menu = UIMenu(children: [menuAction(strings.text(.photos), symbol: "photo", type: "photos"),
                                                menuAction(strings.text(.files), symbol: "doc", type: "files"),
                                                menuAction(strings.text(.location), symbol: "location", type: "location")])
        attachmentButton.widthAnchor.constraint(equalToConstant: 36).isActive = true
        composer.delegate = self
        composer.accessibilityIdentifier = "codex.native.composer"
        composer.accessibilityLabel = strings.text(.composer)
        composer.font = .systemFont(ofSize: 16)
        composer.backgroundColor = .secondarySystemBackground
        composer.layer.cornerRadius = 13
        composer.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        composer.isScrollEnabled = false
        composerHeight = composer.heightAnchor.constraint(equalToConstant: 44)
        composerHeight.isActive = true
        let toolbar = UIToolbar()
        toolbar.sizeToFit()
        let done = UIBarButtonItem(title: strings.text(.done), style: .done, target: self, action: #selector(doneEditing))
        done.accessibilityIdentifier = "codex.native.keyboard.done"
        toolbar.items = [UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil), done]
        composer.inputAccessoryView = toolbar
        sendButton.accessibilityIdentifier = "codex.native.send"
        sendButton.setTitle(strings.text(.send), for: .normal)
        sendButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        sendButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        sendButton.addAction(UIAction { [weak self] _ in self?.send() }, for: .touchUpInside)
        let input = UIStackView(arrangedSubviews: [attachmentButton, composer, sendButton])
        input.spacing = 8
        input.alignment = .bottom
        panel.addArrangedSubview(input)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            panel.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            timeline.bottomAnchor.constraint(equalTo: panel.topAnchor)
        ])
    }

    private func render(_ snapshot: NativeConversationSnapshot, contextChanged: Bool) {
        view.isHidden = !snapshot.visible
        view.accessibilityViewIsModal = snapshot.visible
        backButton?.accessibilityLabel = strings.text(.back)
        menuButton.accessibilityLabel = strings.text(.menu)
        statusButton.setTitle(strings.text(.retry), for: .normal)
        composer.accessibilityLabel = strings.text(.composer)
        attachmentButton.accessibilityLabel = strings.text(.attachments)
        (composer.inputAccessoryView as? UIToolbar)?.items?.last?.title = strings.text(.done)
        latestButton.configuration?.title = strings.text(.latest)
        titleLabel.text = snapshot.title
        subtitleLabel.text = snapshot.subtitle
        subtitleLabel.isHidden = snapshot.subtitle.isEmpty
        statusLabel.text = !snapshot.error.isEmpty ? snapshot.error : (!snapshot.status.isEmpty ? snapshot.status : (snapshot.loadState == "loading" ? strings.text(.loading) : ""))
        statusLabel.textColor = snapshot.error.isEmpty ? .secondaryLabel : .systemRed
        statusButton.isHidden = snapshot.error.isEmpty && snapshot.loadState != "error"
        if composer.markedTextRange == nil {
            let suggestedCursor = state.consumeSuggestedCursor(hasMarkedText: false)
            if composer.text != state.draft || suggestedCursor != nil {
                updatingDraft = true
                let selection = composer.selectedRange
                if composer.text != state.draft { composer.text = state.draft }
                let length = (composer.text as NSString).length
                let cursor = suggestedCursor ?? (contextChanged ? length : selection.location)
                composer.selectedRange = NSRange(location: min(max(cursor, 0), length), length: 0)
                updatingDraft = false
            }
        }
        composer.font = .systemFont(ofSize: CGFloat(min(max(snapshot.fontSize, 12), 24)))
        composer.isEditable = snapshot.enabled
        attachmentButton.isEnabled = snapshot.enabled
        updateSendButton()
        resizeComposer()
        updateMenus(snapshot)
        updateAccessories(snapshot)
        let follow = NativeConversationScrollPolicy.shouldFollow(contextChanged: contextChanged, nearBottom: isNearBottom)
        let anchor = follow ? nil : visibleAnchor()
        let previous = rows
        let fontChanged = renderedFontSize != snapshot.fontSize
        let editingChanged = renderedEditingAllowed != snapshot.allowsEditingMessages
        let localeChanged = renderedLocale != snapshot.locale
        renderedEditingAllowed = snapshot.allowsEditingMessages
        renderedLocale = snapshot.locale
        renderedFontSize = snapshot.fontSize
        rows = Dictionary(snapshot.rows.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        markdownCache = markdownCache.filter { rows[$0.key] != nil }
        var update = NSDiffableDataSourceSnapshot<Int, String>()
        update.appendSections([0])
        var seen = Set<String>()
        let ids = snapshot.rows.map(\.id).filter { seen.insert($0).inserted }
        update.appendItems(ids)
        let previousIds = Set(source.snapshot().itemIdentifiers)
        let changed = ids.filter { previousIds.contains($0) && (previous[$0] != rows[$0] || contextChanged || fontChanged || editingChanged || localeChanged) }
        update.reconfigureItems(changed)
        olderButton.isHidden = snapshot.olderTurnsState == "exhausted" || snapshot.rows.isEmpty
        olderButton.isEnabled = snapshot.olderTurnsState != "loading"
        olderButton.setTitle(snapshot.olderTurnsState == "loading" ? strings.text(.loadingOlder) : (snapshot.olderTurnsState == "error" ? strings.text(.retryOlder) : strings.text(.older)), for: .normal)
        if olderButton.isHidden { timeline.tableHeaderView = nil }
        else if timeline.tableHeaderView == nil { timeline.tableHeaderView = olderButton }
        applyingSnapshot = true
        source.apply(update, animatingDifferences: false) { [weak self] in
            guard let self else { return }
            self.timeline.layoutIfNeeded()
            if follow { self.scrollToBottom(animated: false) }
            else if let anchor { self.restore(anchor) }
            self.applyingSnapshot = false
            self.latestButton.isHidden = self.isNearBottom || ids.isEmpty
        }
        pendingBottomScroll = contextChanged
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        resizeComposer()
        if pendingBottomScroll { pendingBottomScroll = false; scrollToBottom(animated: false) }
    }

    private func updateSendButton() {
        guard let snapshot = state.snapshot else { return }
        let empty = state.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && snapshot.attachments.isEmpty
        let label = snapshot.busy ? (empty ? strings.text(.stop) : strings.text(.queue)) : snapshot.sendLabel
        sendButton.setTitle(label, for: .normal)
        sendButton.accessibilityLabel = label
        sendButton.isEnabled = snapshot.enabled && !state.submissionPending && ((snapshot.busy && empty) || snapshot.sendEnabled)
    }

    private func updateMenus(_ snapshot: NativeConversationSnapshot) {
        var conversationActions = [menuAction(strings.text(.web), symbol: "safari", type: "web")]
        if snapshot.allowsConversationActions {
            conversationActions += [menuAction(strings.text(.pin), symbol: "pin", type: "pin"),
                                    menuAction(strings.text(.duplicate), symbol: "doc.on.doc", type: "duplicate"),
                                    menuAction(strings.text(.rename), symbol: "pencil", type: "rename"),
                                    menuAction(strings.text(.archive), symbol: "archivebox", type: "archive")]
        }
        menuButton.menu = UIMenu(children: conversationActions)
        attachmentButton.menu = UIMenu(children: [menuAction(strings.text(.photos), symbol: "photo", type: "photos"),
                                                menuAction(strings.text(.files), symbol: "doc", type: "files"),
                                                menuAction(strings.text(.location), symbol: "location", type: "location")])
        settingsButton.setTitle(snapshot.settingsLabel, for: .normal)
        settingsButton.menu = UIMenu(children: [menuAction(strings.text(.model), symbol: "slider.horizontal.3", type: "agentSettings"),
                                               menuAction(strings.text(.permissions), symbol: "lock", type: "permissionSettings")])
        projectButton.isEnabled = snapshot.enabled
        backendButton.isEnabled = snapshot.enabled
        configureChoices(projectButton, choices: snapshot.projects, selected: snapshot.selectedProject, fallback: strings.text(.project), type: "project")
        configureChoices(backendButton, choices: snapshot.backends, selected: snapshot.selectedBackendId, fallback: strings.text(.backend), type: "backend")
    }

    private func configureChoices(_ button: UIButton, choices: [NativeConversationChoice], selected: String?, fallback: String, type: String) {
        button.isHidden = choices.isEmpty
        button.setTitle(choices.first(where: { $0.id == selected })?.label ?? fallback, for: .normal)
        button.menu = UIMenu(title: strings.text(.choose) + fallback, children: choices.map { choice in
            UIAction(title: choice.label, state: choice.id == selected ? .on : .off) { [weak self] _ in self?.emit(type, id: choice.id) }
        })
    }

    private func updateAccessories(_ snapshot: NativeConversationSnapshot) {
        let signature = snapshot.locale + ":" + String(snapshot.enabled) + snapshot.attachments.map { "\($0.id):\($0.name):\($0.kind)" }.joined() + snapshot.mentions.map { "\($0.id):\($0.label)" }.joined() + snapshot.queued.map { "\($0.id):\($0.text):\($0.failed)" }.joined()
        guard signature != lastAccessories else { return }
        lastAccessories = signature
        accessories.arrangedSubviews.forEach { accessories.removeArrangedSubview($0); $0.removeFromSuperview() }
        if !snapshot.attachments.isEmpty {
            let chips = snapshot.attachments.map { attachment in
                button(attachment.name + " ×", symbol: attachment.kind == "image" ? "photo" : "doc", identifier: "codex.native.attachment.\(attachment.id)") { [weak self] in self?.emit("removeAttachment", id: attachment.id) }
            }
            accessories.addArrangedSubview(horizontalChips(chips))
        }
        if !snapshot.mentions.isEmpty {
            let chips = snapshot.mentions.map { mention in
                let chip = button(mention.label, symbol: "at", identifier: "codex.native.mention.\(mention.id)") { [weak self] in self?.emit("mention", id: mention.id) }
                chip.accessibilityHint = mention.description
                return chip
            }
            accessories.addArrangedSubview(horizontalChips(chips))
        }
        for queued in snapshot.queued {
            let item = UIButton(type: .system)
            item.setTitle((queued.failed ? strings.text(.retryPrefix) : strings.text(.queuePrefix)) + queued.text, for: .normal)
            item.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
            item.titleLabel?.lineBreakMode = .byTruncatingTail
            item.contentHorizontalAlignment = .leading
            item.isEnabled = snapshot.enabled
            item.showsMenuAsPrimaryAction = true
            item.menu = UIMenu(children: [menuAction(queued.failed ? strings.text(.retry) : strings.text(.sendNow), symbol: "paperplane", type: "queuedAction", id: queued.id),
                                          menuAction(strings.text(.cancelQueued), symbol: "xmark", type: "queuedCancel", id: queued.id)])
            accessories.addArrangedSubview(item)
        }
        accessories.isHidden = accessories.arrangedSubviews.isEmpty
    }

    private func horizontalChips(_ chips: [UIButton]) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        let stack = UIStackView(arrangedSubviews: chips)
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            scroll.heightAnchor.constraint(equalToConstant: 32)
        ])
        return scroll
    }

    func textViewDidChange(_ textView: UITextView) {
        guard !updatingDraft else { return }
        emit("draft", text: textView.text)
        resizeComposer()
        updateSendButton()
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard textView === composer, composer.isFirstResponder, !updatingDraft else { return }
        emit("draft", text: composer.text)
    }

    private func resizeComposer() {
        guard isViewLoaded, composerHeight != nil, composer.bounds.width > 0 else { return }
        let measured = composer.sizeThatFits(CGSize(width: composer.bounds.width, height: .greatestFiniteMagnitude)).height
        let target = min(max(measured, 44), 160)
        if abs(composerHeight.constant - target) > 0.5 { composerHeight.constant = target }
        composer.isScrollEnabled = measured > 160
    }

    @objc private func doneEditing() {
        composer.unmarkText()
        emit("draft", text: composer.text)
        composer.resignFirstResponder()
    }

    private func send() {
        guard let snapshot = state.snapshot, !state.submissionPending else { return }
        composer.unmarkText()
        let text = composer.text ?? ""
        if snapshot.busy && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && snapshot.attachments.isEmpty {
            emit("interrupt")
        } else {
            if text != state.draft { emit("draft", text: text) }
            emit("submit", text: text)
        }
        composer.resignFirstResponder()
        updateSendButton()
    }

    private func back() {
        composer.unmarkText()
        emit("draft", text: composer.text)
        composer.resignFirstResponder()
        emit("back")
    }

    @objc private func edgeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
        if gesture.state == .ended && gesture.translation(in: view).x > 60 { back() }
    }

    private func emit(_ type: String, text: String? = nil, id: String? = nil) {
        let cursor = type == "draft" || type == "mention" ? composer.selectedRange.location : nil
        if let action = state.action(type, text: text, id: id, cursor: cursor) { onAction?(action) }
    }

    private func menuAction(_ title: String, symbol: String, type: String, id: String? = nil) -> UIAction {
        UIAction(title: title, image: UIImage(systemName: symbol), attributes: type == "archive" ? .destructive : []) { [weak self] _ in self?.emit(type, id: id) }
    }

    private func button(_ title: String, symbol: String, identifier: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.accessibilityIdentifier = identifier
        button.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
        return button
    }

    private var isNearBottom: Bool {
        timeline.contentSize.height - timeline.contentOffset.y - timeline.bounds.height + timeline.adjustedContentInset.bottom < 100
    }

    private func visibleAnchor() -> (String, CGFloat)? {
        guard let first = timeline.indexPathsForVisibleRows?.sorted().first,
              let id = source.itemIdentifier(for: first) else { return nil }
        return (id, timeline.rectForRow(at: first).minY - timeline.contentOffset.y)
    }

    private func restore(_ anchor: (String, CGFloat)) {
        guard let index = source.indexPath(for: anchor.0) else { return }
        timeline.scrollToRow(at: index, at: .top, animated: false)
        timeline.layoutIfNeeded()
        let y = timeline.rectForRow(at: index).minY - anchor.1
        timeline.setContentOffset(CGPoint(x: 0, y: max(-timeline.adjustedContentInset.top, y)), animated: false)
    }

    private func scrollToBottom(animated: Bool) {
        let count = source.snapshot().numberOfItems
        guard count > 0 else { return }
        timeline.layoutIfNeeded()
        timeline.scrollToRow(at: IndexPath(row: count - 1, section: 0), at: .bottom, animated: animated)
        latestButton.isHidden = true
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === timeline, !applyingSnapshot else { return }
        latestButton.isHidden = isNearBottom || rows.isEmpty
    }

    private func formatted(_ row: NativeConversationRow) -> NSAttributedString {
        let size = state.snapshot?.fontSize ?? 16
        if let cached = markdownCache[row.id], cached.0 == row.text, cached.1 == size { return cached.2 }
        let rendered = NativeConversationMarkdown.render(row.text, markdown: row.role == "assistant", size: CGFloat(min(max(size, 12), 24)))
        markdownCache[row.id] = (row.text, size, rendered)
        return rendered
    }

    private func showDetail(_ row: NativeConversationRow) {
        guard presentedViewController == nil else { return }
        let detail = NativeConversationDetailViewController(text: row.detail ?? row.text, locale: state.snapshot?.locale ?? "zh-CN")
        let navigation = UINavigationController(rootViewController: detail)
        navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.medium(), .large()]
        navigation.sheetPresentationController?.prefersGrabberVisible = true
        navigation.sheetPresentationController?.prefersScrollingExpandsWhenScrolledToEdge = true
        present(navigation, animated: true)
    }
}

private final class NativeConversationCell: UITableViewCell, UITextViewDelegate {
    private let roleLabel = UILabel()
    private let message = UITextView()
    private let details = UIButton(type: .system)
    private let full = UIButton(type: .system)
    private let edit = UIButton(type: .system)
    var onDetail: (() -> Void)?
    var onWeb: (() -> Void)?
    var onEdit: (() -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .systemBackground
        roleLabel.font = .preferredFont(forTextStyle: .caption1)
        roleLabel.textColor = .secondaryLabel
        message.isEditable = false
        message.delegate = self
        message.isSelectable = true
        message.isScrollEnabled = false
        message.backgroundColor = .clear
        message.textContainerInset = .zero
        message.textContainer.lineFragmentPadding = 0
        message.adjustsFontForContentSizeCategory = true
        details.addAction(UIAction { [weak self] _ in self?.onDetail?() }, for: .touchUpInside)
        full.addAction(UIAction { [weak self] _ in self?.onWeb?() }, for: .touchUpInside)
        edit.addAction(UIAction { [weak self] _ in self?.onEdit?() }, for: .touchUpInside)
        let actions = UIStackView(arrangedSubviews: [details, full, edit])
        actions.axis = .horizontal
        actions.alignment = .leading
        actions.spacing = 12
        let stack = UIStackView(arrangedSubviews: [roleLabel, message, actions])
        stack.axis = .vertical
        stack.spacing = 7
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -14)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
        onWeb?()
        return false
    }

    func configure(_ row: NativeConversationRow, text: NSAttributedString, editable: Bool, strings: NativeConversationStrings) {
        details.setTitle(strings.text(.toolDetails), for: .normal)
        full.setTitle(strings.text(.fullContent), for: .normal)
        edit.setTitle(strings.text(.edit), for: .normal)
        let role = ["user": strings.text(.user), "assistant": strings.text(.assistant), "tool": strings.text(.tool), "system": strings.text(.system)][row.role] ?? row.role
        roleLabel.text = role + (row.timestamp.map { " · \($0)" } ?? "")
        message.attributedText = text
        message.accessibilityIdentifier = "codex.native.row.\(row.id)"
        message.accessibilityLabel = role
        details.isHidden = row.role != "tool"
        full.isHidden = row.rich != true
        edit.isHidden = row.role != "user" || !editable
        details.titleLabel?.font = .systemFont(ofSize: 13)
        full.titleLabel?.font = .systemFont(ofSize: 13)
        edit.titleLabel?.font = .systemFont(ofSize: 13)
    }
}

private final class NativeConversationDetailViewController: UIViewController {
    private let text: String
    private let strings: NativeConversationStrings
    init(text: String, locale: String) {
        self.text = text
        self.strings = NativeConversationStrings(locale: locale)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.accessibilityIdentifier = "codex.native.details"
        title = strings.text(.detailsTitle)
        view.backgroundColor = .systemBackground
        let content = UITextView()
        content.accessibilityIdentifier = "codex.native.details.content"
        content.isEditable = false
        content.isSelectable = true
        content.text = text
        content.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        content.backgroundColor = .systemBackground
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            content.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: strings.text(.done), style: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: strings.text(.copyAll), style: .plain, target: self, action: #selector(copyText))
        navigationItem.leftBarButtonItem?.accessibilityIdentifier = "codex.native.details.done"
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "codex.native.details.copy"
    }
    @objc private func close() { dismiss(animated: true) }
    @objc private func copyText() { UIPasteboard.general.string = text }
}

private enum NativeConversationMarkdown {
    static func render(_ text: String, markdown: Bool, size: CGFloat) -> NSAttributedString {
        let result = NSMutableAttributedString(string: "")
        let ordinary: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size), .foregroundColor: UIColor.label]
        guard markdown else { return NSAttributedString(string: text, attributes: ordinary) }
        // 分离 fenced code，保留空格、缩进和换行；其余段落采用 Foundation Markdown。
        var code = false
        var segment = ""
        func appendSegment() {
            guard !segment.isEmpty else { return }
            if code {
                result.append(NSAttributedString(string: segment, attributes: [.font: UIFont.monospacedSystemFont(ofSize: size - 1, weight: .regular), .foregroundColor: UIColor.label, .backgroundColor: UIColor.secondarySystemBackground]))
            } else if let parsed = try? AttributedString(markdown: segment, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                let rendered = NSMutableAttributedString(attributedString: NSAttributedString(parsed))
                rendered.addAttributes(ordinary, range: NSRange(location: 0, length: rendered.length))
                for run in parsed.runs {
                    let range = NSRange(run.range, in: parsed)
                    let intent = run.inlinePresentationIntent ?? []
                    if intent.contains(.code) {
                        rendered.addAttribute(.font, value: UIFont.monospacedSystemFont(ofSize: size - 1, weight: .regular), range: range)
                    } else {
                        var traits: UIFontDescriptor.SymbolicTraits = []
                        if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
                        if intent.contains(.emphasized) { traits.insert(.traitItalic) }
                        if let descriptor = UIFont.systemFont(ofSize: size).fontDescriptor.withSymbolicTraits(traits) {
                            rendered.addAttribute(.font, value: UIFont(descriptor: descriptor, size: size), range: range)
                        }
                    }
                }
                result.append(rendered)
            } else { result.append(NSAttributedString(string: segment, attributes: ordinary)) }
            segment = ""
        }
        let lines = text.components(separatedBy: "\n")
        for (index, line) in lines.enumerated() {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                appendSegment()
                code.toggle()
            } else {
                segment += line + (index < lines.count - 1 ? "\n" : "")
            }
        }
        appendSegment()
        return result
    }
}
