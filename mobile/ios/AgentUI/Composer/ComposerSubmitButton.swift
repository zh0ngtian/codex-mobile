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
                if guiding { ProgressView().tint(.secondary) }
                else { Image(systemName: stopping ? "stop.fill" : "arrow.up").font(.body) }
            }
            .frame(width: 20, height: 20)
        }
        .modifier(ComposerSubmitAppearance(accent: preferences.accent))
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

/// 已有明确的圆形填充，在 Show Borders 下不再叠加系统玻璃按钮的额外描边。
private struct ComposerSubmitAppearance: ViewModifier {
    @Environment(\.accessibilityShowBorders) private var showBorders
    let accent: AgentAccent
    @Environment(\.isEnabled) private var isEnabled
    @ViewBuilder func body(content: Content) -> some View {
        if showBorders {
            content.buttonStyle(FilledComposerSubmitStyle(accent: accent))
        } else {
            content.modifier(AgentGlassButton(prominent: true, circular: true))
                .controlSize(.regular).tint(accent.color)
                .foregroundStyle(isEnabled ? accent.foreground : Color.primary.opacity(0.25))
        }
    }
}

private struct FilledComposerSubmitStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    let accent: AgentAccent
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 34, height: 34)
            .foregroundStyle(isEnabled ? accent.foreground : Color.primary.opacity(0.25))
            .tint(isEnabled ? accent.foreground : Color.secondary)
            .background(isEnabled ? accent.color : Color.primary.opacity(0.08), in: .circle)
            .contentShape(.circle)
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}
