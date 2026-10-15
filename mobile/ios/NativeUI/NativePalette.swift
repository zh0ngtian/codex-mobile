import SwiftUI
import UIKit

enum NativePalette {
    static let bubble = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(red: 0.28, green: 0.10, blue: 0.20, alpha: 1) : UIColor(red: 1, green: 239 / 255, blue: 245 / 255, alpha: 1)
    })
    static let accent = Color(red: 1, green: 73 / 255, blue: 172 / 255)
    static let bubbleText = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(red: 1, green: 0.56, blue: 0.77, alpha: 1) : UIColor(red: 207 / 255, green: 2 / 255, blue: 117 / 255, alpha: 1)
    })
    static let composerBackdrop = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.08, alpha: 1) : UIColor(white: 242 / 255, alpha: 1)
    })
    static let controlFill = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.12, alpha: 0.5) : UIColor(white: 1, alpha: 0.65)
    })
    static let statusText = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.7, alpha: 1) : UIColor(white: 101 / 255, alpha: 1)
    })
    static let code = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.16, alpha: 1) : UIColor(white: 250 / 255, alpha: 1)
    })
    static let settings = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 30 / 255, alpha: 1) : UIColor(white: 248 / 255, alpha: 1)
    })
    static let settingsCard = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 41 / 255, alpha: 1) : .white
    })
    static let canvas = Color(uiColor: .systemBackground)
    static let secondary = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.65, alpha: 1) : UIColor(white: 143 / 255, alpha: 1)
    })
}
