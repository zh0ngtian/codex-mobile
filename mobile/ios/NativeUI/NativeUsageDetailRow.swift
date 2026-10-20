import SwiftUI

struct NativeUsageDetailRow: View {
    let title: String
    let value: String

    var body: some View {
        LabeledContent {
            Text(value).foregroundStyle(.primary).bold().fixedSize(horizontal: true, vertical: false)
        } label: {
            Text(title).foregroundStyle(.secondary).fixedSize(horizontal: true, vertical: false)
        }
    }
}
