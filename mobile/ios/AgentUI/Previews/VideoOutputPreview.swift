import AVKit
import SwiftUI
import UniformTypeIdentifiers

struct VideoOutputPreview: View {
    @Environment(AppPreferences.self) private var preferences
    let url: URL
    @State private var playback: MediaPlaybackController?

    var body: some View {
        VStack(spacing: 16) {
            if let playback {
                VideoPlayer(player: playback.player)
                    .frame(minHeight: 230, maxHeight: 420)
                    .overlay {
                        if isAudio {
                            Image(systemName: "waveform").font(.largeTitle).foregroundStyle(.white.opacity(0.7))
                                .allowsHitTesting(false).accessibilityHidden(true)
                        }
                    }
                    .clipShape(.rect(cornerRadius: 18))
                    .accessibilityLabel(isAudio ? preferences.text("本地音频播放器", "Local audio player") : preferences.text("本地视频播放器", "Local video player"))
                MediaPlaybackButton(playback: playback, identifier: "preview.playback-toggle")
            } else {
                ProgressView().frame(height: 230)
            }
            Text(preferences.text("点击播放按钮开始播放；点按视频可显示系统进度控件。左上角可下载媒体文件。", "Use Play to start; tap the video to reveal the system timeline. Download the media file from the top left."))
                .font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Spacer(minLength: 0)
        }
        .padding(20)
        .task(id: url, prepare)
        .onDisappear(perform: stop)
    }

    private func prepare() async {
        playback?.pause()
        playback = MediaPlaybackController(url: url)
    }
    private func stop() { playback?.pause() }
    private var isAudio: Bool { UTType(filenameExtension: url.pathExtension)?.conforms(to: .audio) == true }
}
