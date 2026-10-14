import SwiftUI
import AVKit
import UniformTypeIdentifiers
import Combine

struct NativeMediaView: View {
    let source: String
    let title: String
    var audio = false
    @State private var retry = 0
    @State private var player: AVPlayer?
    @State private var localURL: URL?
    @State private var error: String?
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if let player { VideoPlayer(player: player).frame(height: audio ? 120 : 260).accessibilityLabel(title) }
            else if let error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error).foregroundStyle(.secondary).textSelection(.enabled)
                    Button(label("重试", "Retry")) { retry += 1 }
                }
            }
            else { ProgressView() }
        }.task(id: retry, prepare).onDisappear(perform: cleanup)
            .onChange(of: source) { retry += 1 }
            .onChange(of: scenePhase) { _, phase in if phase != .active { player?.pause() } }
            .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime)) { notification in
                guard let item = notification.object as? AVPlayerItem, item === player?.currentItem else { return }
                error = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription ?? label("无法播放媒体", "Unable to play media")
                player?.pause(); player = nil
            }
    }
    private func prepare() async {
        cleanup(); error = nil
        do {
            let mediaURL: URL
            if let url = NativeImageData.remoteURL(source) { mediaURL = url }
            else if let data = NativeMediaSource.data(source) {
                let ext = UTType(mimeType: data.mime)?.preferredFilenameExtension ?? "media"
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-media-\(UUID().uuidString).\(ext)")
                try data.bytes.write(to: url, options: .atomic)
                localURL = url; mediaURL = url
            } else { throw URLError(.unsupportedURL) }
            let asset = AVURLAsset(url: mediaURL)
            guard try await asset.load(.isPlayable) else { throw URLError(.cannotDecodeContentData) }
            guard !Task.isCancelled else { return }
            player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        } catch { if !Task.isCancelled { self.error = "\(label("无法播放媒体", "Unable to play media"))：\(error.localizedDescription)" } }
    }
    private func label(_ chinese: String, _ english: String) -> String { locale.identifier.hasPrefix("zh") ? chinese : english }
    private func cleanup() {
        player?.pause(); player = nil
        if let localURL { try? FileManager.default.removeItem(at: localURL) }
        localURL = nil
    }
}
