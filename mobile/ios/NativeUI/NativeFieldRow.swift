import SwiftUI

struct NativeFieldRow<Content: View>: View {
    let text: String?
    let scale: Double
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            content
            if let text, !text.isEmpty {
                Text(text).foregroundStyle(.secondary).textSelection(.enabled)
                    .modifier(NativeScaledFont(size: 13, scale: scale, relativeTo: .caption))
            }
        }
    }
}
