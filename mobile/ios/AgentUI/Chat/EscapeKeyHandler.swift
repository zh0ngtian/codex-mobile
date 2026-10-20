import SwiftUI
import UIKit

struct EscapeKeyHandler: UIViewControllerRepresentable {
    let action: () -> Void

    func makeUIViewController(context: Context) -> EscapeKeyViewController {
        let controller = EscapeKeyViewController()
        controller.action = action
        return controller
    }

    func updateUIViewController(_ controller: EscapeKeyViewController, context: Context) { controller.action = action }

    static func dismantleUIViewController(_ controller: EscapeKeyViewController, coordinator: ()) {
        controller.resignFirstResponder()
        controller.action = nil
    }
}
