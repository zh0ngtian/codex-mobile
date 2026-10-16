import SwiftUI

struct NativeSettingsHeaderView: View {
    let title: String
    let store: NativeUIStore
    var disabled = false
    var back: (() -> Void)? = nil
    let close: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Text(title)
                .modifier(NativeScaledFont(size: 21, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .title2))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, back == nil ? 24 : 61).padding(.trailing, 62)
                .padding(.top, 38).padding(.bottom, 12)
            HStack {
                if let back {
                    Button(store.label("返回", "Back"), systemImage: "chevron.left", action: back)
                        .labelStyle(.iconOnly).font(.system(size: 17, weight: .regular))
                        .frame(width: 34, height: 34).background(NativePalette.settingsCard, in: .circle)
                        .frame(width: 44, height: 44).contentShape(.circle)
                        .accessibilityIdentifier("native-settings-back")
                }
                Spacer()
                Button(store.label("关闭", "Close"), systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly).font(.system(size: 17, weight: .regular))
                    .frame(width: 34, height: 34).background(NativePalette.settingsCard, in: .circle)
                    .frame(width: 44, height: 44).contentShape(.circle)
                    .accessibilityIdentifier("native-settings-close")
            }
            .foregroundStyle(.secondary).disabled(disabled)
            .padding(.horizontal, 13).padding(.top, 12)
        }
    }
}
