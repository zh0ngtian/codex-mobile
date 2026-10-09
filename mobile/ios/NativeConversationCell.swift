import UIKit

/// 块级排版使长回复、代码和表格各自可读；消息身份仍来自业务层。
final class NativeConversationCell: UITableViewCell, UITextViewDelegate {
    private let stack = UIStackView()
    private var row: NativeConversationRow?
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
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -16)
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ row: NativeConversationRow, blocks: [NativeMarkdownBlock], size: CGFloat, editable: Bool, strings: NativeConversationStrings) {
        self.row = row
        stack.arrangedSubviews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }
        let font = UIFont.systemFont(ofSize: min(max(size + 1, 15), 25))
        if row.role == "tool" {
            let activity = UIButton(type: .system)
            var config = UIButton.Configuration.plain()
            config.title = row.text
            config.image = UIImage(systemName: "chevron.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .medium))
            config.imagePlacement = .trailing
            config.imagePadding = 8
            config.baseForegroundColor = .secondaryLabel
            config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var next = attributes; next.font = .systemFont(ofSize: 14); return next
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
            bubble.layer.cornerRadius = 22
            let text = textView(row.text, font: font, identifier: "codex.native.row.\(row.id)", markdown: false)
            bubble.translatesAutoresizingMaskIntoConstraints = false
            text.translatesAutoresizingMaskIntoConstraints = false
            holder.addSubview(bubble); bubble.addSubview(text)
            NSLayoutConstraint.activate([
                bubble.topAnchor.constraint(equalTo: holder.topAnchor),
                bubble.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
                bubble.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
                bubble.widthAnchor.constraint(equalTo: holder.widthAnchor, multiplier: 0.88),
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
                    stack.addArrangedSubview(textView(text, font: .systemFont(ofSize: font.pointSize + (level <= 2 ? 5 : 2), weight: .semibold), identifier: id))
                case .list(let ordered, let items, let start):
                    let list = UIStackView(); list.axis = .vertical; list.spacing = 10
                    for (itemIndex, item) in items.enumerated() {
                        let marker = UILabel()
                        marker.text = ordered ? "\(itemIndex + start)." : "•"
                        marker.font = font
                        marker.textAlignment = .right
                        marker.widthAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
                        marker.setContentCompressionResistancePriority(.required, for: .horizontal)
                        let body = textView(item, font: font, identifier: "\(id).item.\(itemIndex)")
                        let line = UIStackView(arrangedSubviews: [marker, body]); line.alignment = .top; line.spacing = 10
                        list.addArrangedSubview(line)
                    }
                    stack.addArrangedSubview(list)
                case .quote(let text):
                    let bar = UIView(); bar.backgroundColor = .separator
                    bar.widthAnchor.constraint(equalToConstant: 3).isActive = true
                    let quote = UIStackView(arrangedSubviews: [bar, textView(text, font: font, identifier: id, color: .secondaryLabel)])
                    quote.spacing = 12; stack.addArrangedSubview(quote)
                case .code(let language, let text):
                    stack.addArrangedSubview(codeView(language, text: text, size: font.pointSize, identifier: id, strings: strings))
                case .table(let headers, let rows):
                    stack.addArrangedSubview(tableView(headers, rows: rows, size: font.pointSize, identifier: "codex.native.table.\(row.id).\(index)"))
                case .divider:
                    let divider = UIView(); divider.backgroundColor = .separator
                    divider.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
                    stack.addArrangedSubview(divider)
                }
            }
        }
        let copy = actionButton(strings.text(.copyAll), symbol: "doc.on.doc", action: { UIPasteboard.general.string = row.text })
        copy.accessibilityIdentifier = "codex.native.copy.\(row.id)"
        let more = UIButton(type: .system)
        more.setImage(UIImage(systemName: "ellipsis"), for: .normal)
        more.tintColor = .secondaryLabel
        more.accessibilityLabel = strings.text(.menu)
        more.showsMenuAsPrimaryAction = true
        more.widthAnchor.constraint(equalToConstant: 44).isActive = true
        more.heightAnchor.constraint(equalToConstant: 44).isActive = true
        var actions: [UIMenuElement] = [UIAction(title: strings.text(.copyAll), image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.string = row.text }]
        if row.role == "user" && editable { actions.append(UIAction(title: strings.text(.edit), image: UIImage(systemName: "pencil")) { [weak self] _ in self?.onEdit?() }) }
        if row.rich == true { actions.append(UIAction(title: strings.text(.fullContent), image: UIImage(systemName: "arrow.up.right")) { [weak self] _ in self?.onWeb?() }) }
        more.menu = UIMenu(children: actions)
        let spacer = UIView()
        let footer = UIStackView(arrangedSubviews: row.role == "user" ? [spacer, more] : [copy, more, spacer])
        footer.spacing = 4
        let lastBody = stack.arrangedSubviews.last
        stack.addArrangedSubview(footer)
        if let lastBody { stack.setCustomSpacing(2, after: lastBody) }
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
        button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16)), for: .normal)
        button.tintColor = .secondaryLabel
        button.accessibilityLabel = title
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func codeView(_ language: String, text: String, size: CGFloat, identifier: String, strings: NativeConversationStrings) -> UIView {
        let box = UIStackView(); box.axis = .vertical; box.spacing = 4
        box.backgroundColor = .secondarySystemBackground
        box.layer.cornerRadius = 14; box.clipsToBounds = true
        box.isLayoutMarginsRelativeArrangement = true
        box.layoutMargins = UIEdgeInsets(top: 4, left: 14, bottom: 14, right: 10)
        let label = UILabel(); label.text = language.isEmpty ? "Code" : language
        label.font = .systemFont(ofSize: 12, weight: .medium); label.textColor = .secondaryLabel
        let copy = actionButton(strings.text(.copyCode), symbol: "doc.on.doc", action: { UIPasteboard.general.string = text })
        copy.accessibilityIdentifier = "codex.native.code.copy.\(identifier)"
        let header = UIStackView(arrangedSubviews: [label, copy]); header.alignment = .center
        box.addArrangedSubview(header)
        let body = textView(text, font: .monospacedSystemFont(ofSize: max(14, size - 2), weight: .regular), identifier: identifier, markdown: false)
        box.addArrangedSubview(body)
        return box
    }

    private func tableView(_ headers: [String], rows: [[String]], size: CGFloat, identifier: String) -> UIView {
        let scroll = UIScrollView()
        scroll.accessibilityIdentifier = identifier
        scroll.showsHorizontalScrollIndicator = true
        scroll.isDirectionalLockEnabled = true
        scroll.layer.cornerRadius = 10; scroll.clipsToBounds = true
        let grid = UIStackView(); grid.axis = .vertical; grid.spacing = 1
        grid.backgroundColor = .separator
        grid.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(grid)
        for (index, cells) in ([headers] + rows).enumerated() {
            let line = UIStackView(); line.axis = .horizontal; line.spacing = 1; line.distribution = .fillEqually
            for (column, text) in cells.enumerated() {
                let inset = UIView(); inset.backgroundColor = index == 0 ? .secondarySystemBackground : .systemBackground
                let label = textView(text, font: .systemFont(ofSize: max(14, size - 1), weight: index == 0 ? .semibold : .regular), identifier: "\(identifier).cell.\(index).\(column)")
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
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            grid.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            grid.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            grid.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            grid.widthAnchor.constraint(equalToConstant: CGFloat(max(headers.count, 1)) * 156)
        ])
        return scroll
    }

    func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
        onWeb?(); return false
    }
}
