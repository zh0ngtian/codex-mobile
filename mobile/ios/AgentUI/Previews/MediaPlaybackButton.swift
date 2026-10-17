import SwiftUI

struct MediaPlaybackButton: View {
    @Environment(AppPreferences.self) private var preferences
    let playback: MediaPlaybackController
    let identifier: String

    var body: some View {
        Button(playback.isPaused ? preferences.text("播放", "Play") : preferences.text("暂停", "Pause"),
               systemImage: playback.isPaused ? "play.fill" : "pause.fill", action: playback.togglePlayback)
            .font(.subheadline.weight(.semibold))
            .frame(minWidth: 110, minHeight: 44)
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier(identifier)
            .accessibilityValue(playback.isWaiting ? preferences.text("正在缓冲", "Buffering") : playback.isPaused ? preferences.text("已暂停", "Paused") : preferences.text("正在播放", "Playing"))
    }
}
