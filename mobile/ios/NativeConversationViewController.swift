import UIKit

final class NativeConversationViewController: UIViewController, UITextViewDelegate, UITableViewDelegate {
    var onAction: ((NativeConversationAction) -> Void)?
    private let state = NativeConversationState()
    private let timeline = UITableView(frame: .zero, style: .plain)
    private let composer = UITextView()
    private let sendButton = UIButton(type: .system)
    private let titleLabel = UILabel()
    private let emptyLabel = UILabel()
    private let placeholder = UILabel()
    private let statusStack = UIStackView()
    private let statusLabel = UILabel()
    private let statusButton = UIButton(type: .system)
    private let menuButton = UIButton(type: .system)
    private var backButton: UIButton?
    private let settingsButton = UIButton(type: .system)
    private let attachmentButton = UIButton(type: .system)
    private let latestButton = UIButton(type: .system)
    private let olderButton = UIButton(type: .system)
    private let accessories = UIStackView()
    private var composerHeight: NSLayoutConstraint!
    private var attachmentInline: NSLayoutConstraint!
    private var attachmentBelow: NSLayoutConstraint!
    private var placeholderLeading: NSLayoutConstraint!
    private var expandedComposer = false
    private var renderedAppearance: String?
    private var appearanceRefreshPending = false
    private var source: UITableViewDiffableDataSource<Int, String>!
    private var rows: [String: NativeConversationRow] = [:]
    private var markdownCache: [String: (String, [NativeMarkdownBlock])] = [:]
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
        let back = button("", symbol: "line.3.horizontal", identifier: "codex.native.back") { [weak self] in self?.back() }
        backButton = back
        back.accessibilityLabel = strings.text(.back)
        settingsButton.accessibilityIdentifier = "codex.native.settings"
        settingsButton.showsMenuAsPrimaryAction = true
        var settingsConfiguration = UIButton.Configuration.plain()
        settingsConfiguration.title = "Codex"
        settingsConfiguration.image = UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .medium))
        settingsConfiguration.imagePlacement = .trailing
        settingsConfiguration.imagePadding = 8
        settingsConfiguration.contentInsets = .zero
        settingsConfiguration.baseForegroundColor = .label
        settingsButton.configuration = settingsConfiguration
        settingsButton.setTitleColor(.label, for: .normal)
        settingsButton.setContentHuggingPriority(.defaultLow, for: .horizontal)
        settingsButton.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        settingsButton.titleLabel?.lineBreakMode = .byTruncatingTail
        menuButton.setImage(UIImage(systemName: "ellipsis"), for: .normal)
        menuButton.tintColor = .label
        menuButton.accessibilityLabel = strings.text(.menu)
        menuButton.accessibilityIdentifier = "codex.native.menu"
        menuButton.showsMenuAsPrimaryAction = true
        for control in [back, menuButton] {
            control.widthAnchor.constraint(equalToConstant: 44).isActive = true
            control.heightAnchor.constraint(equalToConstant: 44).isActive = true
        }
        let header = UIStackView(arrangedSubviews: [back, settingsButton, menuButton])
        header.alignment = .center
        header.spacing = 8
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.textColor = NativeConversationAppearance.secondaryText
        statusLabel.numberOfLines = 2
        statusButton.setTitle(strings.text(.retry), for: .normal)
        statusButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        statusButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        statusButton.addAction(UIAction { [weak self] _ in self?.emit("retry") }, for: .touchUpInside)
        statusStack.axis = .vertical
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        let status = UIStackView(arrangedSubviews: [statusLabel, statusButton])
        status.alignment = .center
        status.spacing = 8
        statusStack.addArrangedSubview(status)
        view.addSubview(statusStack)
        emptyLabel.font = .systemFont(ofSize: 26, weight: .semibold)
        emptyLabel.textAlignment = .center
        emptyLabel.numberOfLines = 2
        emptyLabel.textColor = .label
        emptyLabel.accessibilityIdentifier = "codex.native.welcome"
        emptyLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(emptyLabel)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            header.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
            statusStack.topAnchor.constraint(equalTo: header.bottomAnchor),
            statusStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            timeline.topAnchor.constraint(equalTo: statusStack.bottomAnchor, constant: 8),
            emptyLabel.centerXAnchor.constraint(equalTo: timeline.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: timeline.centerYAnchor, constant: -20),
            emptyLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            emptyLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28)
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
            cell.configure(row, blocks: self.formatted(row), size: CGFloat(self.state.snapshot?.fontSize ?? 16), contentWidth: NativeConversationAppearance.contentWidth(in: table.bounds.width), traits: self.traitCollection, editable: self.state.snapshot?.allowsEditingMessages == true, strings: self.strings)
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
        latestButton.accessibilityLabel = strings.text(.latest)
        latestButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        latestButton.tintColor = .label
        latestButton.backgroundColor = .secondarySystemBackground
        latestButton.layer.cornerRadius = 22
        var latestConfiguration = UIButton.Configuration.plain()
        latestConfiguration.image = UIImage(systemName: "arrow.down")
        latestConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
        latestButton.configuration = latestConfiguration
        latestButton.translatesAutoresizingMaskIntoConstraints = false
        latestButton.isHidden = true
        latestButton.addAction(UIAction { [weak self] _ in self?.scrollToBottom(animated: true) }, for: .touchUpInside)
        view.addSubview(latestButton)
        NSLayoutConstraint.activate([
            timeline.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            timeline.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            latestButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            latestButton.widthAnchor.constraint(equalToConstant: 44),
            latestButton.heightAnchor.constraint(equalToConstant: 44),
            latestButton.bottomAnchor.constraint(equalTo: timeline.bottomAnchor, constant: -12)
        ])
    }

    private func buildComposer() {
        let panel = UIStackView()
        panel.axis = .vertical
        panel.spacing = 8
        panel.layoutMargins = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        panel.isLayoutMarginsRelativeArrangement = true
        panel.backgroundColor = .systemBackground
        panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel)
        accessories.axis = .vertical
        accessories.spacing = 8
        accessories.isHidden = true
        panel.addArrangedSubview(accessories)
        let capsule = UIView()
        capsule.backgroundColor = .secondarySystemBackground
        capsule.layer.cornerRadius = NativeConversationAppearance.inputCorner
        capsule.accessibilityIdentifier = "codex.native.input"
        panel.addArrangedSubview(capsule)
        attachmentButton.setImage(UIImage(systemName: "plus"), for: .normal)
        attachmentButton.tintColor = .label
        attachmentButton.accessibilityLabel = strings.text(.attachments)
        attachmentButton.accessibilityIdentifier = "codex.native.attachments"
        attachmentButton.showsMenuAsPrimaryAction = true
        composer.delegate = self
        composer.accessibilityIdentifier = "codex.native.composer"
        composer.accessibilityLabel = strings.text(.composer)
        composer.font = .systemFont(ofSize: 17)
        composer.backgroundColor = .clear
        composer.textContainerInset = UIEdgeInsets(top: 10, left: 0, bottom: 8, right: 0)
        composer.textContainer.lineFragmentPadding = 0
        composer.isScrollEnabled = false
        composerHeight = composer.heightAnchor.constraint(equalToConstant: 44)
        composerHeight.isActive = true
        placeholder.font = .systemFont(ofSize: 17)
        placeholder.textColor = NativeConversationAppearance.secondaryText
        placeholder.isUserInteractionEnabled = false
        let toolbar = UIToolbar()
        toolbar.sizeToFit()
        let done = UIBarButtonItem(image: UIImage(systemName: "keyboard.chevron.compact.down"), style: .plain, target: self, action: #selector(doneEditing))
        done.accessibilityLabel = strings.text(.done)
        done.accessibilityIdentifier = "codex.native.keyboard.done"
        toolbar.items = [UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil), done]
        composer.inputAccessoryView = toolbar
        sendButton.accessibilityIdentifier = "codex.native.send"
        sendButton.layer.cornerRadius = 22
        sendButton.addAction(UIAction { [weak self] _ in self?.send() }, for: .touchUpInside)
        for item in [composer, placeholder, attachmentButton, sendButton] {
            item.translatesAutoresizingMaskIntoConstraints = false
            capsule.addSubview(item)
        }
        attachmentInline = attachmentButton.centerYAnchor.constraint(equalTo: composer.centerYAnchor)
        attachmentBelow = attachmentButton.topAnchor.constraint(equalTo: composer.bottomAnchor)
        placeholderLeading = placeholder.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 44)
        NSLayoutConstraint.activate([
            composer.topAnchor.constraint(equalTo: capsule.topAnchor, constant: 8),
            composer.leadingAnchor.constraint(equalTo: capsule.leadingAnchor, constant: 18),
            composer.trailingAnchor.constraint(equalTo: capsule.trailingAnchor, constant: -18),
            placeholderLeading,
            placeholder.topAnchor.constraint(equalTo: composer.topAnchor, constant: 10),
            placeholder.trailingAnchor.constraint(lessThanOrEqualTo: composer.trailingAnchor),
            attachmentButton.leadingAnchor.constraint(equalTo: capsule.leadingAnchor, constant: 8),
            attachmentInline,
            attachmentButton.bottomAnchor.constraint(equalTo: capsule.bottomAnchor, constant: -8),
            attachmentButton.widthAnchor.constraint(equalToConstant: 44),
            attachmentButton.heightAnchor.constraint(equalToConstant: 44),
            sendButton.trailingAnchor.constraint(equalTo: capsule.trailingAnchor, constant: -8),
            sendButton.centerYAnchor.constraint(equalTo: attachmentButton.centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 44),
            sendButton.heightAnchor.constraint(equalToConstant: 44),
            panel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            panel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor),
            panel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor),
            panel.widthAnchor.constraint(lessThanOrEqualToConstant: NativeConversationAppearance.readingWidth + 24),
            panel.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            timeline.bottomAnchor.constraint(equalTo: panel.topAnchor)
        ])
        let panelWidth = panel.widthAnchor.constraint(equalTo: view.widthAnchor)
        panelWidth.priority = .defaultHigh
        panelWidth.isActive = true
    }

    private func render(_ snapshot: NativeConversationSnapshot, contextChanged: Bool) {
        view.isHidden = !snapshot.visible
        view.accessibilityViewIsModal = snapshot.visible
        backButton?.accessibilityLabel = strings.text(.back)
        menuButton.accessibilityLabel = strings.text(.menu)
        statusButton.setTitle(strings.text(.retry), for: .normal)
        composer.accessibilityLabel = strings.text(.composer)
        attachmentButton.accessibilityLabel = strings.text(.attachments)
        (composer.inputAccessoryView as? UIToolbar)?.items?.last?.accessibilityLabel = strings.text(.done)
        latestButton.accessibilityLabel = strings.text(.latest)
        placeholder.text = strings.text(.composer)
        emptyLabel.text = strings.text(.welcome)
        emptyLabel.isHidden = !snapshot.rows.isEmpty || snapshot.loadState == "loading"
        titleLabel.text = snapshot.title
        let headerFont = NativeConversationAppearance.scaled(18, style: .headline, traits: traitCollection, weight: .semibold)
        settingsButton.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var next = attributes; next.font = headerFont; return next
        }
        emptyLabel.font = NativeConversationAppearance.scaled(26, style: .title1, traits: traitCollection, weight: .semibold)
        statusLabel.font = .preferredFont(forTextStyle: .footnote, compatibleWith: traitCollection)
        olderButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote, compatibleWith: traitCollection)
        olderButton.frame.size.height = max(44, (olderButton.titleLabel?.font.lineHeight ?? 0) + 16)
        statusLabel.text = !snapshot.error.isEmpty ? snapshot.error : (!snapshot.status.isEmpty ? snapshot.status : (snapshot.loadState == "loading" ? strings.text(.loading) : ""))
        statusLabel.textColor = snapshot.error.isEmpty ? NativeConversationAppearance.secondaryText : .systemRed
        statusStack.arrangedSubviews.first?.isHidden = statusLabel.text?.isEmpty != false
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
        composer.font = NativeConversationAppearance.body(CGFloat(snapshot.fontSize), traits: traitCollection)
        placeholder.font = composer.font
        composer.isEditable = snapshot.enabled
        attachmentButton.isEnabled = snapshot.enabled
        updateSendButton()
        resizeComposer()
        updateMenus(snapshot)
        updateAccessories(snapshot)
        let follow = NativeConversationScrollPolicy.shouldFollow(contextChanged: contextChanged, nearBottom: isNearBottom)
        let anchor = follow ? nil : visibleAnchor()
        let previous = rows
        let fontChanged = renderedFontSize != snapshot.fontSize || renderedAppearance != appearanceSignature
        renderedAppearance = appearanceSignature
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
            if self.appearanceRefreshPending { self.refreshAppearanceIfNeeded() }
            self.latestButton.isHidden = self.isNearBottom || ids.isEmpty
        }
        pendingBottomScroll = contextChanged
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        resizeComposer()
        refreshAppearanceIfNeeded()
        if pendingBottomScroll { pendingBottomScroll = false; scrollToBottom(animated: false) }
    }

    private var appearanceSignature: String {
        "\(traitCollection.preferredContentSizeCategory.rawValue):\(Int(timeline.bounds.width.rounded()))"
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
            refreshAppearanceIfNeeded()
        }
    }

    private func refreshAppearanceIfNeeded() {
        guard isViewLoaded, timeline.bounds.width > 0, renderedAppearance != appearanceSignature else {
            appearanceRefreshPending = false; return
        }
        appearanceRefreshPending = true
        guard !applyingSnapshot else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.appearanceRefreshPending, !self.applyingSnapshot, let snapshot = self.state.snapshot else { return }
            self.appearanceRefreshPending = false
            self.render(snapshot, contextChanged: false)
        }
    }

    private func updateSendButton() {
        guard let snapshot = state.snapshot else { return }
        let empty = state.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && snapshot.attachments.isEmpty
        let label = snapshot.busy ? (empty ? strings.text(.stop) : strings.text(.queue)) : snapshot.sendLabel
        sendButton.setImage(UIImage(systemName: snapshot.busy && empty ? "stop.fill" : "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)), for: .normal)
        sendButton.accessibilityLabel = label
        sendButton.isEnabled = snapshot.enabled && !state.submissionPending && ((snapshot.busy && empty) || snapshot.sendEnabled)
        sendButton.backgroundColor = sendButton.isEnabled ? .label : .tertiaryLabel
        sendButton.tintColor = .systemBackground
        placeholder.isHidden = !state.draft.isEmpty
    }

    private func updateMenus(_ snapshot: NativeConversationSnapshot) {
        var conversationActions = [menuAction(strings.text(.web), symbol: "safari", type: "web")]
        if snapshot.allowsConversationActions {
            conversationActions += [menuAction(strings.text(.pin), symbol: "pin", type: "pin"),
                                    menuAction(strings.text(.duplicate), symbol: "doc.on.doc", type: "duplicate"),
                                    menuAction(strings.text(.rename), symbol: "pencil", type: "rename"),
                                    menuAction(strings.text(.archive), symbol: "archivebox", type: "archive")]
        }
        var contextMenus: [UIMenuElement] = [menuAction(strings.text(.model), symbol: "slider.horizontal.3", type: "agentSettings"),
                                                menuAction(strings.text(.permissions), symbol: "lock", type: "permissionSettings")]
        if !snapshot.projects.isEmpty {
            contextMenus.append(choiceMenu(snapshot.projects, selected: snapshot.selectedProject, title: strings.text(.project), type: "project"))
        }
        if !snapshot.backends.isEmpty {
            contextMenus.append(choiceMenu(snapshot.backends, selected: snapshot.selectedBackendId, title: strings.text(.backend), type: "backend"))
        }
        menuButton.menu = UIMenu(title: snapshot.title, children: [UIMenu(title: snapshot.subtitle, options: .displayInline, children: contextMenus),
                                                                                UIMenu(options: .displayInline, children: conversationActions)])
        attachmentButton.menu = UIMenu(children: [menuAction(strings.text(.photos), symbol: "photo", type: "photos"),
                                                menuAction(strings.text(.files), symbol: "doc", type: "files"),
                                                menuAction(strings.text(.location), symbol: "location", type: "location")])
        settingsButton.setTitle("Codex", for: .normal)
        settingsButton.accessibilityLabel = snapshot.modelLabel + ", " + strings.text(.settings)
        settingsButton.menu = UIMenu(title: snapshot.settingsLabel, children: contextMenus)
    }

    private func choiceMenu(_ choices: [NativeConversationChoice], selected: String?, title: String, type: String) -> UIMenu {
        UIMenu(title: title, children: choices.map { choice in
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
        if !snapshot.queued.isEmpty {
            let item = UIButton(type: .system)
            item.setTitle(strings.text(.queuedCount).replacingOccurrences(of: "{count}", with: String(snapshot.queued.count)), for: .normal)
            item.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
            item.titleLabel?.lineBreakMode = .byTruncatingTail
            item.contentHorizontalAlignment = .leading
            item.isEnabled = snapshot.enabled
            item.showsMenuAsPrimaryAction = true
            item.heightAnchor.constraint(equalToConstant: 44).isActive = true
            item.menu = UIMenu(children: snapshot.queued.map { queued in
                UIMenu(title: queued.text, children: [menuAction(queued.failed ? strings.text(.retry) : strings.text(.sendNow), symbol: "paperplane", type: "queuedAction", id: queued.id),
                                                     menuAction(strings.text(.cancelQueued), symbol: "xmark", type: "queuedCancel", id: queued.id)])
            })
            accessories.addArrangedSubview(item)
        }
        accessories.isHidden = accessories.arrangedSubviews.isEmpty
    }

    private func horizontalChips(_ chips: [UIButton]) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        let stack = UIStackView(arrangedSubviews: chips)
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            scroll.heightAnchor.constraint(equalToConstant: 44)
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
        guard isViewLoaded, composerHeight != nil, composer.bounds.width > 0, let font = composer.font else { return }
        // 单行使用左右按钮留白；多行和辅助字号把操作移到下方，不改变文本或 selection。
        let availableInlineWidth = max(composer.bounds.width - 92, 1)
        let lineWidth = (composer.text ?? "").size(withAttributes: [.font: font]).width
        let expanded = traitCollection.preferredContentSizeCategory.isAccessibilityCategory || font.pointSize > 23 || composer.text.contains("\n") || lineWidth > availableInlineWidth
        if expandedComposer != expanded {
            expandedComposer = expanded
            NSLayoutConstraint.deactivate([attachmentInline, attachmentBelow])
            (expanded ? attachmentBelow : attachmentInline).isActive = true
        }
        let inset = expanded ? CGFloat(0) : 44
        let rightInset = expanded ? CGFloat(0) : 48
        if composer.textContainerInset.left != inset || composer.textContainerInset.right != rightInset {
            composer.textContainerInset = UIEdgeInsets(top: 10, left: inset, bottom: 8, right: rightInset)
        }
        placeholderLeading.constant = inset
        let measured = composer.sizeThatFits(CGSize(width: composer.bounds.width, height: .greatestFiniteMagnitude)).height
        let minimum = max(44, ceil(font.lineHeight + 18))
        let maximum = max(160, minimum)
        let target = min(max(measured, minimum), maximum)
        if abs(composerHeight.constant - target) > 0.5 { composerHeight.constant = target }
        composer.isScrollEnabled = measured > maximum
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
        button.tintColor = .label
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
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
        timeline.scrollToRow(at: IndexPath(row: count - 1, section: 0), at: .bottom, animated: animated && !UIAccessibility.isReduceMotionEnabled)
        latestButton.isHidden = true
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === timeline, !applyingSnapshot else { return }
        latestButton.isHidden = isNearBottom || rows.isEmpty
    }

    private func formatted(_ row: NativeConversationRow) -> [NativeMarkdownBlock] {
        if let cached = markdownCache[row.id], cached.0 == row.text { return cached.1 }
        let blocks = row.role == "assistant" ? NativeMarkdown.parse(row.text) : [.paragraph(row.text)]
        markdownCache[row.id] = (row.text, blocks)
        return blocks
    }

    private func showDetail(_ row: NativeConversationRow) {
        guard presentedViewController == nil else { return }
        let detail = NativeConversationDetailViewController(text: row.detail ?? row.text, locale: state.snapshot?.locale ?? "zh-CN")
        let navigation = UINavigationController(rootViewController: detail)
        navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.medium(), .large()]
        navigation.sheetPresentationController?.prefersGrabberVisible = true
        navigation.sheetPresentationController?.prefersScrollingExpandsWhenScrolledToEdge = true
        present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
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
        content.font = NativeConversationAppearance.scaled(14, style: .body, traits: traitCollection, monospaced: true)
        content.adjustsFontForContentSizeCategory = true
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
    @objc private func close() { dismiss(animated: !UIAccessibility.isReduceMotionEnabled) }
    @objc private func copyText() { UIPasteboard.general.string = text }
}
