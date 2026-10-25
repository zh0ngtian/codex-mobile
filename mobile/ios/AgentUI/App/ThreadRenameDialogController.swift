import UIKit

/// 名称输入、模型总结、取消/保存各自拥有独立区域，不借用额外文本框承载按钮。
@MainActor final class ThreadRenameDialogController: UIViewController, UITextFieldDelegate {
    private let configuration: ThreadRenameAlert
    private let targetID: UUID
    private let nameField = UITextField()
    private let summaryButton = UIButton(type: .system)
    private let saveButton = UIButton(type: .system)
    private let errorLabel = UILabel()
    private var request: Task<Void, Never>?

    init(configuration: ThreadRenameAlert, id: UUID) {
        self.configuration = configuration
        targetID = id
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.tintColor = .label
        view.backgroundColor = UIColor.black.withAlphaComponent(0.22)
        view.accessibilityViewIsModal = true

        let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        panel.layer.cornerRadius = 28
        panel.clipsToBounds = true
        panel.accessibilityIdentifier = "rename.dialog"
        panel.accessibilityContainerType = .semanticGroup
        panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel)

        let title = UILabel()
        title.text = configuration.title
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center

        nameField.text = configuration.initialName
        nameField.placeholder = configuration.fieldLabel
        nameField.accessibilityLabel = configuration.fieldLabel
        nameField.accessibilityIdentifier = "rename.name"
        nameField.font = .preferredFont(forTextStyle: .body)
        nameField.adjustsFontForContentSizeCategory = true
        nameField.backgroundColor = .tertiarySystemFill
        nameField.layer.cornerRadius = 22
        nameField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        nameField.leftViewMode = .always
        nameField.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        nameField.rightViewMode = .always
        nameField.returnKeyType = .done
        nameField.delegate = self
        nameField.addAction(UIAction { [weak self] _ in self?.updateSave() }, for: .editingChanged)

        configure(summaryButton, title: configuration.summaryLabel)
        summaryButton.accessibilityIdentifier = "rename.model-summary"
        summaryButton.addAction(UIAction { [weak self] _ in self?.summarize() }, for: .touchUpInside)
        let cancel = UIButton(type: .system)
        configure(cancel, title: configuration.cancelLabel)
        cancel.addAction(UIAction { [weak self] _ in self?.configuration.cancel() }, for: .touchUpInside)
        configure(saveButton, title: configuration.saveLabel)
        saveButton.addAction(UIAction { [weak self] _ in self?.save() }, for: .touchUpInside)
        let controls = UIStackView(arrangedSubviews: [cancel, saveButton])
        controls.axis = .horizontal; controls.spacing = 8; controls.distribution = .fillEqually

        errorLabel.font = .preferredFont(forTextStyle: .footnote)
        errorLabel.adjustsFontForContentSizeCategory = true
        errorLabel.numberOfLines = 0
        errorLabel.isHidden = true

        let stack = UIStackView(arrangedSubviews: [title, nameField, summaryButton, errorLabel, controls])
        stack.axis = .vertical; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView.addSubview(stack)

        let available = UILayoutGuide()
        view.addLayoutGuide(available)
        NSLayoutConstraint.activate([
            available.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            available.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            available.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            available.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            panel.centerXAnchor.constraint(equalTo: available.centerXAnchor),
            panel.centerYAnchor.constraint(equalTo: available.centerYAnchor),
            panel.widthAnchor.constraint(equalToConstant: 320),
            panel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -40),
            stack.topAnchor.constraint(equalTo: panel.contentView.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor, constant: -20),
            nameField.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        updateSave()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        nameField.becomeFirstResponder()
        UIAccessibility.post(notification: .screenChanged, argument: nameField)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        request?.cancel()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }

    private func configure(_ button: UIButton, title: String) {
        var style = UIButton.Configuration.filled()
        style.title = title
        style.baseForegroundColor = .label
        style.baseBackgroundColor = .secondarySystemFill
        style.cornerStyle = .capsule
        style.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
        button.configuration = style
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }

    private var name: String { (nameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    private func updateSave() { saveButton.isEnabled = request == nil && !name.isEmpty && name != configuration.initialName }
    private func save() {
        guard saveButton.isEnabled else { return }
        configuration.save(targetID, name)
    }
    private func summarize() {
        guard request == nil else { return }
        summaryButton.isEnabled = false; summaryButton.configuration?.showsActivityIndicator = true
        nameField.isEnabled = false; saveButton.isEnabled = false; errorLabel.isHidden = true
        let configuration = configuration
        let id = targetID
        request = Task { [weak self] in
            let result = await configuration.summarize(id)
            guard let self, !Task.isCancelled, self.view.window != nil else { return }
            self.request = nil
            self.summaryButton.isEnabled = true; self.summaryButton.configuration?.showsActivityIndicator = false
            self.nameField.isEnabled = true
            if let title = result.title { self.nameField.text = title }
            else { self.errorLabel.text = result.error; self.errorLabel.isHidden = false }
            self.updateSave()
            self.nameField.becomeFirstResponder()
        }
    }
}
