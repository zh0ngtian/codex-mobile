import UIKit

/// 块级排版使长回复、代码和表格各自可读；消息身份仍来自业务层。
final class NativeConversationCell: UITableViewCell, UITextViewDelegate, UIContextMenuInteractionDelegate {
    private let stack = UIStackView()
    private var row: NativeConversationRow?
    private var displayTraits = UITraitCollection()
    private var messageActions: [UIMenuElement] = []
    var onDetail: (() -> Void)?
    var onWeb: (() -> Void)?
    var onEdit: (() -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .systemBackground
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        let width = stack.widthAnchor.constraint(equalTo: contentView.widthAnchor, constant: -NativeConversationAppearance.readingInset * 2)
        width.priority = .defaultHigh
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor, constant: NativeConversationAppearance.readingInset),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -NativeConversationAppearance.readingInset),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: NativeConversationAppearance.readingWidth),
            width,
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -16)
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ row: NativeConversationRow, blocks: [NativeMarkdownBlock], size: CGFloat, contentWidth: CGFloat, traits: UITraitCollection, editable: Bool, strings: NativeConversationStrings) {
        self.row = row
        displayTraits = traits
        stack.arrangedSubviews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }
        let font = NativeConversationAppearance.body(size, traits: displayTraits)
        messageActions = [UIAction(title: strings.text(.copyAll), image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.string = row.text }]
        if row.role == "user" && editable {
            messageActions.append(UIAction(title: strings.text(.edit), image: UIImage(systemName: "pencil")) { [weak self] _ in self?.onEdit?() })
        }
        if row.rich == true {
            messageActions.append(UIAction(title: strings.text(.fullContent), image: UIImage(systemName: "arrow.up.right")) { [weak self] _ in self?.onWeb?() })
        }
        if row.role == "tool" {
            let activity = UIButton(type: .system)
            var config = UIButton.Configuration.plain()
            config.title = row.text
            config.image = UIImage(systemName: "chevron.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .medium))
            config.imagePlacement = .trailing
            config.imagePadding = 8
            config.baseForegroundColor = NativeConversationAppearance.secondaryText
            config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0)
            let activityFont = NativeConversationAppearance.scaled(14, style: .footnote, traits: displayTraits)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var next = attributes; next.font = activityFont; return next
            }
            activity.configuration = config
            activity.contentHorizontalAlignment = .leading
            activity.accessibilityIdentifier = "codex.native.activity.\(row.id)"
            activity.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
            activity.addAction(UIAction { [weak self] _ in self?.onDetail?() }, for: .touchUpInside)
            stack.addArrangedSubview(activity)
            if row.rich == true { stack.addArrangedSubview(actionButton(strings.text(.fullContent), symbol: "arrow.up.right", action: { [weak self] in self?.onWeb?() })) }
            return
        }
        if row.role == "user" {
            let holder = UIView()
            let bubble = UIView()
            bubble.backgroundColor = .secondarySystemBackground
            bubble.layer.cornerRadius = NativeConversationAppearance.messageCorner
            bubble.addInteraction(UIContextMenuInteraction(delegate: self))
            let text = textView(row.text, font: font, identifier: "codex.native.row.\(row.id)", markdown: false)
            text.accessibilityCustomActions = [UIAccessibilityCustomAction(name: strings.text(.copyAll)) { _ in
                UIPasteboard.general.string = row.text; return true
            }]
            if editable {
                text.accessibilityCustomActions?.append(UIAccessibilityCustomAction(name: strings.text(.edit)) { [weak self] _ in
                    guard let action = self?.onEdit else { return false }; action(); return true
                })
            }
            if row.rich == true {
                text.accessibilityCustomActions?.append(UIAccessibilityCustomAction(name: strings.text(.fullContent)) { [weak self] _ in
                    guard let action = self?.onWeb else { return false }; action(); return true
                })
            }
            let maxWidth = max(contentWidth * 0.88, 64)
            let measured = text.attributedText.boundingRect(with: CGSize(width: maxWidth - 32, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
            let bubbleWidth = min(max(ceil(measured.width) + 32, 64), maxWidth)
            bubble.translatesAutoresizingMaskIntoConstraints = false
            text.translatesAutoresizingMaskIntoConstraints = false
            holder.addSubview(bubble); bubble.addSubview(text)
            NSLayoutConstraint.activate([
                bubble.topAnchor.constraint(equalTo: holder.topAnchor),
                bubble.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
                bubble.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
                bubble.widthAnchor.constraint(equalToConstant: bubbleWidth),
                text.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 16),
                text.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -16),
                text.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 12),
                text.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -12)
            ])
            stack.addArrangedSubview(holder)
        } else {
            for (index, block) in blocks.enumerated() {
                let id = index == 0 ? "codex.native.row.\(row.id)" : "codex.native.row.\(row.id).block.\(index)"
                switch block {
                case .paragraph(let text):
                    stack.addArrangedSubview(textView(text, font: font, identifier: id))
                case .heading(let level, let text):
                    stack.addArrangedSubview(textView(text, font: NativeConversationAppearance.scaled(min(max(size + 1, 15), 25) + (level <= 2 ? 5 : 2), style: .headline, traits: displayTraits, weight: .semibold), identifier: id))
                case .list(let ordered, let items, let start):
                    let list = UIStackView(); list.axis = .vertical; list.spacing = 12
                    for (itemIndex, item) in items.enumerated() {
                        let marker = UILabel()
                        marker.text = ordered ? "\(itemIndex + start)." : "•"
                        marker.font = font
                        marker.textAlignment = .right
                        marker.widthAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
                        marker.setContentCompressionResistancePriority(.required, for: .horizontal)
                        let body = textView(item, font: font, identifier: "\(id).item.\(itemIndex)")
                        let line = UIStackView(arrangedSubviews: [marker, body]); line.alignment = .top; line.spacing = 12
                        list.addArrangedSubview(line)
                    }
                    stack.addArrangedSubview(list)
                case .quote(let text):
                    let bar = UIView(); bar.backgroundColor = .separator
                    bar.widthAnchor.constraint(equalToConstant: 3).isActive = true
                    let quote = UIStackView(arrangedSubviews: [bar, textView(text, font: font, identifier: id, color: NativeConversationAppearance.secondaryText)])
                    quote.spacing = 12; stack.addArrangedSubview(quote)
                case .code(let language, let text):
                    stack.addArrangedSubview(codeView(language, text: text, size: size, identifier: id, strings: strings))
                case .table(let headers, let rows):
                    stack.addArrangedSubview(tableView(headers, rows: rows, size: size, contentWidth: contentWidth, identifier: "codex.native.table.\(row.id).\(index)"))
                case .divider:
                    let divider = UIView(); divider.backgroundColor = .separator
                    divider.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
                    stack.addArrangedSubview(divider)
                }
            }
        }
        guard row.role != "user" else { return }
        let copy = actionButton(strings.text(.copyAll), symbol: "doc.on.doc", action: { UIPasteboard.general.string = row.text })
        copy.accessibilityIdentifier = "codex.native.copy.\(row.id)"
        let more = UIButton(type: .system)
        more.setImage(UIImage(systemName: "ellipsis"), for: .normal)
        more.tintColor = NativeConversationAppearance.secondaryText
        more.accessibilityLabel = strings.text(.menu)
        more.showsMenuAsPrimaryAction = true
        more.widthAnchor.constraint(equalToConstant: NativeConversationAppearance.touchTarget).isActive = true
        more.heightAnchor.constraint(equalToConstant: NativeConversationAppearance.touchTarget).isActive = true
        more.menu = UIMenu(children: messageActions)
        let footer = UIStackView(arrangedSubviews: [copy, more, UIView()])
        footer.spacing = 8
        let lastBody = stack.arrangedSubviews.last
        stack.addArrangedSubview(footer)
        if let lastBody { stack.setCustomSpacing(2, after: lastBody) }
    }

    func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
        UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
            UIMenu(children: self?.messageActions ?? [])
        }
    }

    private func editingMenu(_ suggestedActions: [UIMenuElement]) -> UIMenu? {
        guard row?.role == "user" else { return nil }
        return UIMenu(children: suggestedActions + messageActions)
    }

    func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
        editingMenu(suggestedActions)
    }

    @available(iOS 26.0, *)
    func textView(_ textView: UITextView, editMenuForTextInRanges ranges: [NSValue], suggestedActions: [UIMenuElement]) -> UIMenu? {
        editingMenu(suggestedActions)
    }

    private func textView(_ text: String, font: UIFont, identifier: String, markdown: Bool = true, color: UIColor = .label) -> UITextView {
        let view = UITextView()
        view.isEditable = false; view.isSelectable = true; view.isScrollEnabled = false
        view.delegate = self
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.accessibilityIdentifier = identifier
        if markdown { view.attributedText = NativeMarkdown.inline(text, font: font, color: color) }
        else {
            let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 4
            view.attributedText = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
        }
        view.linkTextAttributes = [.foregroundColor: UIColor.link, .underlineStyle: NSUnderlineStyle.single.rawValue]
        return view
    }

    private func actionButton(_ title: String, symbol: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18)), for: .normal)
        button.tintColor = NativeConversationAppearance.secondaryText
        button.accessibilityLabel = title
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func codeView(_ language: String, text: String, size: CGFloat, identifier: String, strings: NativeConversationStrings) -> UIView {
        let box = UIStackView(); box.axis = .vertical; box.spacing = 4
        box.backgroundColor = .secondarySystemBackground
        box.layer.cornerRadius = NativeConversationAppearance.codeCorner; box.clipsToBounds = true
        box.isLayoutMarginsRelativeArrangement = true
        box.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 16, right: 12)
        let label = UILabel(); label.text = language.isEmpty ? "Code" : language
        label.font = NativeConversationAppearance.scaled(12, style: .caption1, traits: displayTraits, weight: .medium); label.textColor = NativeConversationAppearance.secondaryText
        let copy = actionButton(strings.text(.copyCode), symbol: "doc.on.doc", action: { UIPasteboard.general.string = text })
        copy.accessibilityIdentifier = "codex.native.code.copy.\(identifier)"
        let header = UIStackView(arrangedSubviews: [label, copy]); header.alignment = .center
        box.addArrangedSubview(header)
        let body = textView(text, font: NativeConversationAppearance.scaled(max(14, size - 1), style: .body, traits: displayTraits, monospaced: true), identifier: identifier, markdown: false)
        box.addArrangedSubview(body)
        return box
    }

    private func tableView(_ headers: [String], rows: [[String]], size: CGFloat, contentWidth: CGFloat, identifier: String) -> UIView {
        let scroll = UIScrollView()
        scroll.accessibilityIdentifier = identifier
        scroll.showsHorizontalScrollIndicator = true
        scroll.isDirectionalLockEnabled = true
        scroll.layer.cornerRadius = NativeConversationAppearance.codeCorner; scroll.clipsToBounds = true
        let grid = UIStackView(); grid.axis = .vertical; grid.spacing = 1
        grid.backgroundColor = .separator
        grid.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(grid)
        for (index, cells) in ([headers] + rows).enumerated() {
            let line = UIStackView(); line.axis = .horizontal; line.spacing = 1; line.distribution = .fillEqually
            for (column, text) in cells.enumerated() {
                let inset = UIView(); inset.backgroundColor = index == 0 ? .secondarySystemBackground : .systemBackground
                let label = textView(text, font: NativeConversationAppearance.body(size - 1, traits: displayTraits, weight: index == 0 ? .semibold : .regular), identifier: "\(identifier).cell.\(index).\(column)")
                label.translatesAutoresizingMaskIntoConstraints = false
                inset.addSubview(label)
                NSLayoutConstraint.activate([
                    label.leadingAnchor.constraint(equalTo: inset.leadingAnchor, constant: 12),
                    label.trailingAnchor.constraint(equalTo: inset.trailingAnchor, constant: -12),
                    label.topAnchor.constraint(equalTo: inset.topAnchor, constant: 12),
                    label.bottomAnchor.constraint(equalTo: inset.bottomAnchor, constant: -12)
                ])
                line.addArrangedSubview(inset)
            }
            grid.addArrangedSubview(line)
        }
        // 单列不超过 viewport，保证滑到最后一列时左侧文字也完整可见。
        let viewport = max(contentWidth, 156)
        let columnWidth = min(viewport, max(156, NativeConversationAppearance.body(size - 1, traits: displayTraits).pointSize * 8))
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            grid.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            grid.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            grid.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            grid.widthAnchor.constraint(equalToConstant: max(viewport, CGFloat(max(headers.count, 1)) * columnWidth))
        ])
        return scroll
    }

    func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
        onWeb?(); return false
    }
}
