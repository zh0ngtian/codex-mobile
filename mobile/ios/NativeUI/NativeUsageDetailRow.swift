import SwiftUI

struct NativeUsageDetailRow: View {
    let title: String
    let value: String

    var body: some View {
        LabeledContent {
            Text(value).foregroundStyle(.primary).bold()
        } label: {
            Text(title).foregroundStyle(.secondary)
        }
    }
}
