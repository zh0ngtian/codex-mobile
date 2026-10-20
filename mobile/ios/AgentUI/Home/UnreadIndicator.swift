import SwiftUI

struct UnreadIndicator: View {
    @Environment(AppPreferences.self) private var preferences
    let isUnread: Bool

    var body: some View {
        Circle()
            .fill(isUnread ? preferences.accent.color : .clear)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}
