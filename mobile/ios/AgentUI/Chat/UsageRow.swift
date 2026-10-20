import SwiftUI

struct UsageRow: View {
    let title: String
    let value: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).monospacedDigit().multilineTextAlignment(.trailing)
        }
        .font(.body)
        .accessibilityElement(children: .combine)
    }
}
