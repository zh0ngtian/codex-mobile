import AVKit
import SwiftUI

struct OutputVideoCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let item: OutputItem
    @State private var playback: MediaPlaybackController?
    @State private var readFailed = false

    var body: some View {
        VStack(spacing: 0) {
            if let playback {
                VideoPlayer(player: playback.player)
                    .frame(height: 190)
                    .accessibilityLabel(preferences.text("内嵌视频播放器", "Inline video player"))
            } else if readFailed {
                Label(preferences.text("读取失败，点击文件查看重试选项", "Read failed. Open the file for retry options"), systemImage: "exclamationmark.triangle")
                    .font(.body).foregroundStyle(.secondary).padding(18)
            } else {
                ProgressView().frame(height: 190)
            }
            Button(action: open) { OutputCardLabel(item: item) }
                .buttonStyle(.plain)
        }
        .background(AgentTheme.card, in: .rect(cornerRadius: 16))
        .clipShape(.rect(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(AgentTheme.line) }
        .task(id: item.id, prepare)
        .onDisappear(perform: stop)
    }

    private func prepare() async {
        playback?.pause()
        playback = nil
        readFailed = false
        do {
            let loaded = try await PreviewLoader.load(item)
            guard !Task.isCancelled else { return }
            guard let url = loaded.videoURL else { throw PreviewLoadError.invalidVideo }
            playback = MediaPlaybackController(url: url)
        } catch { readFailed = true }
    }
    private func open() { stop(); session.previewItem = item }
    private func stop() { playback?.pause() }
}
