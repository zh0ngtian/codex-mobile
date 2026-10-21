import AVKit
import SwiftUI

struct OutputVideoCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let item: OutputItem
    @State private var playback: MediaPlaybackController?
    @State private var readFailed = false

    var body: some View {
        Button(action: open) {
            VStack(spacing: 0) {
                if let playback {
                    VideoPlayer(player: playback.player)
                        .frame(height: 190)
                        .overlay {
                            Image(systemName: "play.fill")
                                .font(.title2).foregroundStyle(.white)
                                .frame(width: 52, height: 52)
                                .background(.black.opacity(0.55), in: .circle)
                        }
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                } else if readFailed {
                    Label(preferences.text("读取失败，点击查看重试选项", "Read failed. Open the preview for retry options"), systemImage: "exclamationmark.triangle")
                        .font(.body).foregroundStyle(.secondary).padding(18)
                } else {
                    ProgressView().frame(height: 190)
                }
                OutputCardLabel(item: item)
            }
            .background(AgentTheme.card, in: .rect(cornerRadius: 16))
            .clipShape(.rect(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(AgentTheme.line) }
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.name)
        .accessibilityHint(preferences.text("打开视频预览", "Open video preview"))
        .accessibilityIdentifier("output.video-preview.\(item.id.uuidString)")
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
