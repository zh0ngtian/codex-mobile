import UIKit

@MainActor
enum Clipboard {
    static func copy(_ text: String) { UIPasteboard.general.string = text }
}
