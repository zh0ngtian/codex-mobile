import SwiftUI

struct RunSpeedButton: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        let context = session.nativeSnapshot.contextId
        Button { session.toggleMenuFast(context: context) } label: {
            Image(systemName: session.composer.configuration.speed.symbol)
                .symbolVariant(.none)
                .font(.body).imageScale(.large)
                .foregroundStyle(AgentTheme.ink)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .tint(AgentTheme.ink)
        .disabled(!session.currentCapabilities.supportsFast || !session.composerCanEdit || session.historyEdit != nil || session.nativeSnapshot.models.first(where: { $0.value == session.nativeSnapshot.modelValue })?.title != session.composer.configuration.model)
        .accessibilityLabel(preferences.text("速度", "Speed"))
        .accessibilityValue(session.composer.configuration.speed == .fast ? "Fast" : preferences.text("普通速度", "Normal speed"))
        .accessibilityIdentifier("composer.fast")
    }

}
