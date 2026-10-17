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
                if guiding { ProgressView() }
                else { Image(systemName: stopping ? "stop.fill" : "arrow.up").font(.body) }
            }
            .frame(width: 20, height: 20)
        }
        .modifier(AgentGlassButton(prominent: true, circular: true))
        .controlSize(.large)
        .tint(preferences.accent.color)
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
