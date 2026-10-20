import SwiftUI

struct NativeSettingsDetailView<Content: View>: View {
    let panel: NativePanel
    let store: NativeUIStore
    let back: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            NativeSettingsHeaderView(title: panel.title, store: store, disabled: panel.dismissible == false,
                                     back: back, close: close)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let error = store.commandError {
                        Text(error).foregroundStyle(.red).textSelection(.enabled)
                            .accessibilityIdentifier("native-settings-command-error")
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 48)
            }
            .scrollIndicators(.hidden).scrollDismissesKeyboard(.interactively)
        }
        .background(NativePalette.settings)
        .navigationTitle(panel.title).navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden().toolbarVisibility(.hidden, for: .navigationBar)
        .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale))
    }

    private func close() {
        store.closePanel()
        store.settingsOpen = false
    }
}
