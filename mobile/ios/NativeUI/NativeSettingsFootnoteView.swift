import SwiftUI

struct NativeSettingsFootnoteView: View {
    let text: String
    let scale: Double

    var body: some View {
        Text(text)
            .modifier(NativeScaledFont(size: 11, scale: scale, relativeTo: .caption))
            .foregroundStyle(.secondary).lineSpacing(4 * scale)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 17, alignment: .leading)
            .padding(.horizontal, 15)
    }
}
