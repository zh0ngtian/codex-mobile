import SwiftUI

struct RunSpeedButton: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        Button(action: toggleSpeed) {
            Image(systemName: session.composer.configuration.speed.symbol)
                .symbolVariant(.none)
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .tint(AgentTheme.ink)
        .disabled(!session.currentCapabilities.supportsFast)
        .accessibilityLabel(preferences.text("速度", "Speed"))
        .accessibilityValue(session.composer.configuration.speed == .fast ? "Fast" : preferences.text("普通速度", "Normal speed"))
        .accessibilityIdentifier("reasoning.speed")
    }

    private func toggleSpeed() {
        session.composer.configuration.speed = session.composer.configuration.speed == .normal ? .fast : .normal
        session.configurationDidChange()
    }
}
