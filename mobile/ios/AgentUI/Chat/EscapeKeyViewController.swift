import UIKit

final class EscapeKeyViewController: UIViewController {
    var action: (() -> Void)?
    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        let command = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(closeCard))
        command.wantsPriorityOverSystemBehavior = true
        return [command]
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if presses.contains(where: { $0.key?.keyCode == .keyboardEscape }) {
            action?()
        } else {
            super.pressesBegan(presses, with: event)
        }
    }

    @objc private func closeCard() { action?() }
}
