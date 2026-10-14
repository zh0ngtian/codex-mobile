import SwiftUI
import UIKit

enum NativePalette {
    static let bubble = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(red: 0.14, green: 0.20, blue: 0.30, alpha: 1) : UIColor(red: 237 / 255, green: 243 / 255, blue: 254 / 255, alpha: 1)
    })
    static let accent = Color(red: 72 / 255, green: 118 / 255, blue: 249 / 255)
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
    static let secondary = Color(uiColor: .secondaryLabel)
}
