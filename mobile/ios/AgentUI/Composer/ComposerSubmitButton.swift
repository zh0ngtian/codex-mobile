import SwiftUI

struct ComposerSubmitButton: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let action: () -> Void
    private var busy: Bool { session.isBusy }
    private var stopping: Bool { busy && !session.composer.hasContent }
    private var guiding: Bool { session.selectedConversation?.queue.contains { $0.state == .guiding } == true }
    var body: some View {
        Button(action: action) {
            Group {
                if guiding { ProgressView().tint(preferences.accent.foreground) }
                else { Image(systemName: stopping ? "stop.fill" : "arrow.up").font(.body.bold()) }
            }
            .foregroundStyle(preferences.accent.foreground)
            .frame(width: 30, height: 30)
            .background(preferences.accent.color.opacity(enabled ? 1 : 0.3), in: .circle)
            .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier("composer.submit")
    }
    private var enabled: Bool { !guiding && session.historyEdit == nil && (stopping || session.canSubmit) }
    private var label: String {
        if guiding { return preferences.text("正在引导", "Steering") }
        if stopping { return preferences.text("停止", "Stop") }
        return busy ? preferences.text("排队", "Queue message") : preferences.text("发送", "Send")
    }
}
