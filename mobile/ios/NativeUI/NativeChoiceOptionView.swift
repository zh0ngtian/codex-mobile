import SwiftUI

struct NativeChoiceOptionView: View {
    let option: NativeOption
    let scale: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(option.title).modifier(NativeScaledFont(size: 16, scale: scale))
            if let subtitle = option.subtitle, !subtitle.isEmpty {
                Text(subtitle).foregroundStyle(.secondary).modifier(NativeScaledFont(size: 13, scale: scale, relativeTo: .caption))
            }
        }
    }
}
