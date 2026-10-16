import SwiftUI

struct NativePermissionOptionView: View {
    let option: NativeOption
    let selected: Bool
    var scale: Double = 1
    let choose: () -> Void
    @ScaledMetric(relativeTo: .body) private var minimumHeight = 77
    @ScaledMetric(relativeTo: .body) private var iconSize = 21
    private var elevated: Bool { option.value == "full-access" }
    private var symbol: String { elevated ? "exclamationmark.shield" : option.value == "read-only" ? "hand.raised" : "checkmark.shield" }

    var body: some View {
        Button(action: choose) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: iconSize * scale)).frame(width: 24).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(option.title).modifier(NativeScaledFont(size: 13, scale: scale, weight: .semibold))
                    if let description = option.subtitle {
                        Text(description).modifier(NativeScaledFont(size: 11, scale: scale, weight: .medium, relativeTo: .caption))
                            .foregroundStyle(elevated ? Color.orange : Color.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                if selected { Image(systemName: "checkmark").font(.body.bold()).foregroundStyle(Color.primary).accessibilityHidden(true) }
            }.padding(.vertical, 12).frame(minHeight: minimumHeight * scale).contentShape(.rect)
        }
        .buttonStyle(.plain).foregroundStyle(elevated ? Color.orange : Color.primary)
        .accessibilityLabel(option.title).accessibilityHint(option.subtitle ?? "")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
