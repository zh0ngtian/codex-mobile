import SwiftUI

struct NativeComposerOptionGroup: View {
    let title: String
    let options: [NativeOption]
    let selected: String?
    var scale: Double = 1
    let choose: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).modifier(NativeScaledFont(size: 12, scale: scale, relativeTo: .caption))
                .foregroundStyle(Color.secondary).padding(.horizontal, 14)
            VStack(spacing: 0) {
                ForEach(options) { option in
                    VStack(spacing: 0) {
                        Button { choose(option.value) } label: {
                            HStack(spacing: 12) {
                                Text(option.title).foregroundStyle(Color.primary)
                                Spacer(minLength: 0)
                                if option.value == selected {
                                    Image(systemName: "checkmark").foregroundStyle(NativePalette.bubbleText).accessibilityHidden(true)
                                }
                            }
                            .modifier(NativeScaledFont(size: 14, scale: scale))
                            .padding(.vertical, 13).frame(minHeight: 50).contentShape(.rect)
                        }.buttonStyle(.plain).accessibilityAddTraits(option.value == selected ? .isSelected : [])
                        if option.id != options.last?.id { Divider() }
                    }
                }
            }.padding(.horizontal, 15).background(NativePalette.settingsCard, in: .rect(cornerRadius: 22))
        }
    }
}
