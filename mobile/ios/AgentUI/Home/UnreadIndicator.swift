import SwiftUI

struct UnreadIndicator: View {
    let isUnread: Bool

    var body: some View {
        Circle()
            .fill(isUnread ? Color.accentColor : .clear)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}
